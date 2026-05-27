//+------------------------------------------------------------------+
//|                                       SuperChartsBridge.mq5      |
//|                                       SuperCharts terminal       |
//|                                                                  |
//|  Bridges a MetaTrader 5 terminal to the SuperCharts backend via  |
//|  a plain TCP socket (newline-delimited JSON, one message per     |
//|  line). The EA streams account/positions/ticks outbound and      |
//|  accepts open/modify/close/partial/trailing/breakeven commands.  |
//|                                                                  |
//|  Compile and attach to any chart. The chart symbol does not      |
//|  restrict streaming — symbols are subscribed by the backend via  |
//|  `mt5_subscribe_symbols` commands, and the EA calls               |
//|  SymbolSelect() to make them available in the Market Watch.      |
//+------------------------------------------------------------------+
#property copyright "SuperCharts"
#property version   "0.10"
#property strict

#include <Trade/Trade.mqh>
#include <Trade/PositionInfo.mqh>
#include <Trade/OrderInfo.mqh>
#include <Trade/SymbolInfo.mqh>

//--- inputs the user fills in once when attaching the EA
input string  InpHost              = "127.0.0.1";   // backend host
input int     InpPort              = 7878;          // backend TCP port (raw socket)
input string  InpAccountToken      = "";            // pairing token from SuperCharts web UI
input int     InpMagic             = 880011;        // magic number for trades from this EA
input int     InpHeartbeatSec      = 5;             // heartbeat interval seconds
input int     InpAccountSnapshotMs = 1500;          // how often to push account snapshot
input int     InpPositionSnapshotMs= 1500;          // how often to push positions snapshot
input bool    InpStreamAllTicks    = false;         // stream ticks for every Market Watch symbol
input string  InpDefaultSymbols    = "EURUSD,GBPUSD,USDJPY,XAUUSD"; // initial subscribed symbols

//+------------------------------------------------------------------+
//| Globals                                                          |
//+------------------------------------------------------------------+
int      g_socket             = INVALID_HANDLE;
bool     g_helloSent          = false;
datetime g_lastConnectAttempt = 0;
ulong    g_lastAccountFlushMs = 0;
ulong    g_lastPositionFlushMs= 0;
ulong    g_lastHeartbeatMs    = 0;
string   g_recvBuffer         = "";
string   g_outQueue[];
int      g_outCount           = 0;

CTrade         g_trade;
CPositionInfo  g_pos;
COrderInfo     g_order;
CSymbolInfo    g_sym;

// Subscribed broker symbol list. Backend manages it via the
// `mt5_subscribe_symbols` command.
string g_symbols[];
int    g_symbolCount = 0;

//+------------------------------------------------------------------+
//| Utilities                                                        |
//+------------------------------------------------------------------+
ulong NowMs()
  {
   // GetTickCount64 is monotonic across day rollovers; mix in TimeCurrent for
   // wall-clock anchor used by the backend.
   return (ulong)((long)TimeCurrent() * 1000 + (long)(GetTickCount() % 1000));
  }

string JsonEscape(const string s)
  {
   string out = "";
   int len = StringLen(s);
   for(int i = 0; i < len; i++)
     {
      ushort ch = StringGetCharacter(s, i);
      switch(ch)
        {
         case '"':  out += "\\\""; break;
         case '\\': out += "\\\\"; break;
         case '\n': out += "\\n";  break;
         case '\r': out += "\\r";  break;
         case '\t': out += "\\t";  break;
         default:
            if(ch < 0x20) out += StringFormat("\\u%04x", ch);
            else          out += ShortToString(ch);
        }
     }
   return out;
  }

string DoubleJ(double v, int digits = 8)
  {
   return DoubleToString(v, digits);
  }

string IntJ(long v)
  {
   return IntegerToString(v);
  }

string BoolJ(bool v)
  {
   return v ? "true" : "false";
  }

string StrJ(const string v)
  {
   return "\"" + JsonEscape(v) + "\"";
  }

string AccountIdRaw()
  {
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string server = AccountInfoString(ACCOUNT_SERVER);
   return StringFormat("%d@%s", login, server);
  }

string TradeModeStr()
  {
   ENUM_ACCOUNT_TRADE_MODE m = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(m == ACCOUNT_TRADE_MODE_DEMO)    return "demo";
   if(m == ACCOUNT_TRADE_MODE_CONTEST) return "contest";
   return "real";
  }

//+------------------------------------------------------------------+
//| Outgoing queue + socket flush                                    |
//+------------------------------------------------------------------+
void QueueOut(const string json)
  {
   if(g_outCount >= ArraySize(g_outQueue))
      ArrayResize(g_outQueue, g_outCount + 32);
   g_outQueue[g_outCount++] = json;
  }

void FlushOutgoing()
  {
   if(g_socket == INVALID_HANDLE) return;
   for(int i = 0; i < g_outCount; i++)
     {
      string line = g_outQueue[i] + "\n";
      uchar bytes[];
      int len = StringToCharArray(line, bytes, 0, WHOLE_ARRAY, CP_UTF8);
      if(len > 0 && bytes[len - 1] == 0) len--; // drop the implicit null terminator
      int sent = SocketSend(g_socket, bytes, len);
      if(sent <= 0)
        {
         Print("SocketSend failed err=", GetLastError(), ", reconnecting");
         CloseSocket();
         break;
        }
     }
   g_outCount = 0;
  }

//+------------------------------------------------------------------+
//| Connection management                                            |
//+------------------------------------------------------------------+
void CloseSocket()
  {
   if(g_socket != INVALID_HANDLE)
     {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
     }
   g_helloSent = false;
   g_recvBuffer = "";
   g_outCount   = 0;
  }

bool ConnectIfNeeded()
  {
   if(g_socket != INVALID_HANDLE) return true;
   datetime now = TimeCurrent();
   if(now - g_lastConnectAttempt < 2) return false; // throttle reconnects
   g_lastConnectAttempt = now;

   g_socket = SocketCreate();
   if(g_socket == INVALID_HANDLE)
     {
      Print("SocketCreate failed: ", GetLastError());
      return false;
     }
   if(!SocketConnect(g_socket, InpHost, InpPort, 2000))
     {
      Print("SocketConnect ", InpHost, ":", InpPort, " failed: ", GetLastError());
      CloseSocket();
      return false;
     }
   Print("SuperCharts bridge connected to ", InpHost, ":", InpPort);
   return true;
  }

//+------------------------------------------------------------------+
//| Outbound builders                                                |
//+------------------------------------------------------------------+
string AccountSummaryJson()
  {
   string s = "{";
   s += "\"id\":"        + StrJ(AccountIdRaw()) + ",";
   s += "\"login\":"     + IntJ((long)AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   s += "\"broker\":"    + StrJ(AccountInfoString(ACCOUNT_COMPANY))   + ",";
   s += "\"server\":"    + StrJ(AccountInfoString(ACCOUNT_SERVER))    + ",";
   s += "\"currency\":"  + StrJ(AccountInfoString(ACCOUNT_CURRENCY))  + ",";
   s += "\"name\":"      + StrJ(AccountInfoString(ACCOUNT_NAME))      + ",";
   s += "\"leverage\":"  + IntJ((long)AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   s += "\"tradeMode\":" + StrJ(TradeModeStr()) + ",";
   s += "\"updatedAt\":" + IntJ((long)(TimeCurrent() * 1000));
   s += "}";
   return s;
  }

string SymbolInfoJson(const string sym)
  {
   if(!g_sym.Name(sym))
      return "";
   g_sym.RefreshRates();
   string s = "{";
   s += "\"id\":"             + StrJ("MT5:" + AccountInfoString(ACCOUNT_COMPANY) + ":" + sym) + ",";
   s += "\"raw\":"            + StrJ(sym) + ",";
   s += "\"description\":"    + StrJ(g_sym.Description()) + ",";
   s += "\"digits\":"         + IntJ(g_sym.Digits()) + ",";
   s += "\"point\":"          + DoubleJ(g_sym.Point()) + ",";
   s += "\"tickValue\":"      + DoubleJ(g_sym.TickValue()) + ",";
   s += "\"tickSize\":"       + DoubleJ(g_sym.TickSize()) + ",";
   s += "\"contractSize\":"   + DoubleJ(g_sym.ContractSize()) + ",";
   s += "\"volumeMin\":"      + DoubleJ(g_sym.LotsMin(), 4) + ",";
   s += "\"volumeMax\":"      + DoubleJ(g_sym.LotsMax(), 4) + ",";
   s += "\"volumeStep\":"     + DoubleJ(g_sym.LotsStep(), 4) + ",";
   s += "\"marginInitial\":"  + DoubleJ(SymbolInfoDouble(sym, SYMBOL_MARGIN_INITIAL)) + ",";
   s += "\"swapLong\":"       + DoubleJ(SymbolInfoDouble(sym, SYMBOL_SWAP_LONG)) + ",";
   s += "\"swapShort\":"      + DoubleJ(SymbolInfoDouble(sym, SYMBOL_SWAP_SHORT)) + ",";
   s += "\"baseCurrency\":"   + StrJ(SymbolInfoString(sym, SYMBOL_CURRENCY_BASE)) + ",";
   s += "\"quoteCurrency\":"  + StrJ(SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT)) + ",";
   s += "\"stopsLevel\":"     + IntJ((long)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL));
   s += "}";
   return s;
  }

void SendHello()
  {
   string s = "{";
   s += "\"type\":\"mt5_hello\",";
   s += "\"eaVersion\":\"0.10\",";
   s += "\"token\":"   + StrJ(InpAccountToken) + ",";
   s += "\"account\":" + AccountSummaryJson() + ",";
   // Send all Market Watch + default symbols specs
   string symsSeen[];
   int symsCount = 0;
   ArrayResize(symsSeen, 0);
   string defs[];
   int defCount = StringSplit(InpDefaultSymbols, ',', defs);
   string syms = "";
   for(int i = 0; i < defCount; i++)
     {
      string sym = defs[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) == 0) continue;
      if(!SymbolSelect(sym, true)) continue;
      string spec = SymbolInfoJson(sym);
      if(StringLen(spec) == 0) continue;
      if(StringLen(syms) > 0) syms += ",";
      syms += spec;
      ArrayResize(symsSeen, symsCount + 1);
      symsSeen[symsCount++] = sym;
      AddSymbol(sym);
     }
   int total = SymbolsTotal(true);
   for(int i = 0; i < total; i++)
     {
      string sym = SymbolName(i, true);
      bool exists = false;
      for(int j = 0; j < symsCount; j++) if(symsSeen[j] == sym) { exists = true; break; }
      if(exists) continue;
      string spec = SymbolInfoJson(sym);
      if(StringLen(spec) == 0) continue;
      if(StringLen(syms) > 0) syms += ",";
      syms += spec;
     }
   s += "\"symbols\":[" + syms + "]";
   s += "}";
   QueueOut(s);
   g_helloSent = true;
  }

void SendAccountSnapshot()
  {
   string s = "{";
   s += "\"type\":\"mt5_account_snapshot\",";
   s += "\"snapshot\":{";
   s += "\"account\":"     + AccountSummaryJson() + ",";
   s += "\"balance\":"     + DoubleJ(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   s += "\"equity\":"      + DoubleJ(AccountInfoDouble(ACCOUNT_EQUITY), 2)  + ",";
   s += "\"margin\":"      + DoubleJ(AccountInfoDouble(ACCOUNT_MARGIN), 2)  + ",";
   s += "\"freeMargin\":"  + DoubleJ(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   s += "\"marginLevel\":" + DoubleJ(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
   s += "\"profit\":"      + DoubleJ(AccountInfoDouble(ACCOUNT_PROFIT), 2) + ",";
   s += "\"serverTime\":"  + IntJ((long)(TimeCurrent() * 1000));
   s += "}}";
   QueueOut(s);
  }

string PositionJson(ulong ticket)
  {
   if(!g_pos.SelectByTicket(ticket)) return "";
   ENUM_POSITION_TYPE typ = g_pos.PositionType();
   string side = (typ == POSITION_TYPE_BUY) ? "buy" : "sell";
   string s = "{";
   s += "\"id\":"            + StrJ(IntegerToString(ticket)) + ",";
   s += "\"accountId\":"     + StrJ(AccountIdRaw()) + ",";
   s += "\"symbol\":"        + StrJ(g_pos.Symbol()) + ",";
   s += "\"side\":"          + StrJ(side) + ",";
   s += "\"volume\":"        + DoubleJ(g_pos.Volume(), 4) + ",";
   s += "\"initialVolume\":" + DoubleJ(g_pos.Volume(), 4) + ",";
   s += "\"openPrice\":"     + DoubleJ(g_pos.PriceOpen(), 8) + ",";
   s += "\"sl\":"            + DoubleJ(g_pos.StopLoss(), 8) + ",";
   s += "\"tp\":"            + DoubleJ(g_pos.TakeProfit(), 8) + ",";
   s += "\"profit\":"        + DoubleJ(g_pos.Profit(), 2) + ",";
   s += "\"swap\":"          + DoubleJ(g_pos.Swap(), 2) + ",";
   s += "\"commission\":"    + DoubleJ(g_pos.Commission(), 2) + ",";
   s += "\"openedAt\":"      + IntJ((long)g_pos.Time() * 1000) + ",";
   s += "\"closedAt\":0,";
   s += "\"comment\":"       + StrJ(g_pos.Comment()) + ",";
   s += "\"magic\":"         + IntJ((long)g_pos.Magic()) + ",";
   s += "\"state\":\"open\"";
   s += "}";
   return s;
  }

string PendingOrderJson(ulong ticket)
  {
   if(!g_order.Select(ticket)) return "";
   ENUM_ORDER_TYPE ot = g_order.OrderType();
   string side = "buy";
   string kind = "limit";
   switch(ot)
     {
      case ORDER_TYPE_BUY_LIMIT:   side = "buy";  kind = "limit"; break;
      case ORDER_TYPE_SELL_LIMIT:  side = "sell"; kind = "limit"; break;
      case ORDER_TYPE_BUY_STOP:    side = "buy";  kind = "stop";  break;
      case ORDER_TYPE_SELL_STOP:   side = "sell"; kind = "stop";  break;
      case ORDER_TYPE_BUY_STOP_LIMIT:  side = "buy";  kind = "stop_limit"; break;
      case ORDER_TYPE_SELL_STOP_LIMIT: side = "sell"; kind = "stop_limit"; break;
      default: return ""; // skip filled/cancelled here
     }
   string tif = "gtc";
   ENUM_ORDER_TYPE_TIME tt = (ENUM_ORDER_TYPE_TIME)g_order.TypeTime();
   if(tt == ORDER_TIME_DAY)       tif = "day";
   else if(tt == ORDER_TIME_SPECIFIED) tif = "specified";
   string s = "{";
   s += "\"id\":"        + StrJ(IntegerToString(ticket)) + ",";
   s += "\"accountId\":" + StrJ(AccountIdRaw()) + ",";
   s += "\"symbol\":"    + StrJ(g_order.Symbol()) + ",";
   s += "\"side\":"      + StrJ(side) + ",";
   s += "\"kind\":"      + StrJ(kind) + ",";
   s += "\"volume\":"    + DoubleJ(g_order.VolumeInitial(), 4) + ",";
   s += "\"price\":"     + DoubleJ(g_order.PriceOpen(), 8) + ",";
   if(kind == "stop_limit")
      s += "\"stopLimitPrice\":" + DoubleJ(g_order.PriceStopLimit(), 8) + ",";
   s += "\"sl\":"        + DoubleJ(g_order.StopLoss(), 8) + ",";
   s += "\"tp\":"        + DoubleJ(g_order.TakeProfit(), 8) + ",";
   s += "\"tif\":"       + StrJ(tif) + ",";
   s += "\"expiresAt\":" + IntJ((long)g_order.TimeExpiration() * 1000) + ",";
   s += "\"placedAt\":"  + IntJ((long)g_order.TimeSetup() * 1000) + ",";
   s += "\"comment\":"   + StrJ(g_order.Comment()) + ",";
   s += "\"magic\":"     + IntJ((long)g_order.Magic()) + ",";
   s += "\"state\":\"accepted\"";
   s += "}";
   return s;
  }

void SendPositionsSnapshot()
  {
   string positions = "";
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      string js = PositionJson(ticket);
      if(StringLen(js) == 0) continue;
      if(StringLen(positions) > 0) positions += ",";
      positions += js;
     }
   string orders = "";
   for(int i = 0; i < OrdersTotal(); i++)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      string js = PendingOrderJson(ticket);
      if(StringLen(js) == 0) continue;
      if(StringLen(orders) > 0) orders += ",";
      orders += js;
     }
   string s = "{";
   s += "\"type\":\"mt5_positions_snapshot\",";
   s += "\"accountId\":" + StrJ(AccountIdRaw()) + ",";
   s += "\"positions\":[" + positions + "],";
   s += "\"pending\":["   + orders + "]";
   s += "}";
   QueueOut(s);
  }

void SendTick(const string sym)
  {
   MqlTick t;
   if(!SymbolInfoTick(sym, t)) return;
   string s = "{";
   s += "\"type\":\"mt5_tick\",";
   s += "\"tick\":{";
   s += "\"accountId\":"     + StrJ(AccountIdRaw()) + ",";
   s += "\"symbol\":"        + StrJ(sym) + ",";
   s += "\"bid\":"           + DoubleJ(t.bid) + ",";
   s += "\"ask\":"           + DoubleJ(t.ask) + ",";
   s += "\"last\":"          + DoubleJ(t.last == 0 ? (t.bid + t.ask) / 2 : t.last) + ",";
   s += "\"volume\":"        + IntJ((long)t.volume) + ",";
   s += "\"time\":"          + IntJ((long)t.time * 1000) + ",";
   s += "\"receivedAt\":"    + IntJ((long)TimeCurrent() * 1000) + ",";
   s += "\"spreadPoints\":"  + IntJ((long)MathRound((t.ask - t.bid) / SymbolInfoDouble(sym, SYMBOL_POINT)));
   s += "}}";
   QueueOut(s);
  }

void SendHeartbeat()
  {
   string s = "{";
   s += "\"type\":\"mt5_heartbeat\",";
   s += "\"accountId\":"  + StrJ(AccountIdRaw()) + ",";
   s += "\"serverTime\":" + IntJ((long)TimeCurrent() * 1000);
   s += "}";
   QueueOut(s);
  }

void SendOrderResult(const string clientId,
                     const string state,
                     ulong ticket,
                     double filledVolume,
                     double filledPrice,
                     int retcode,
                     const string retcodeText,
                     const string comment,
                     const string posJson,
                     const string ordJson)
  {
   string s = "{";
   s += "\"type\":\"mt5_order_result\",";
   s += "\"result\":{";
   s += "\"clientId\":"      + StrJ(clientId) + ",";
   s += "\"accountId\":"     + StrJ(AccountIdRaw()) + ",";
   s += "\"state\":"         + StrJ(state) + ",";
   if(ticket > 0)
      s += "\"ticket\":"     + StrJ(IntegerToString(ticket)) + ",";
   s += "\"filledVolume\":"  + DoubleJ(filledVolume, 4) + ",";
   s += "\"filledPrice\":"   + DoubleJ(filledPrice, 8) + ",";
   s += "\"retcode\":"       + IntJ(retcode) + ",";
   s += "\"retcodeText\":"   + StrJ(retcodeText) + ",";
   s += "\"comment\":"       + StrJ(comment);
   if(StringLen(posJson) > 0) s += ",\"position\":" + posJson;
   if(StringLen(ordJson) > 0) s += ",\"order\":"    + ordJson;
   s += ",\"serverTime\":"   + IntJ((long)TimeCurrent() * 1000);
   s += "}}";
   QueueOut(s);
  }

//+------------------------------------------------------------------+
//| Symbol subscription                                              |
//+------------------------------------------------------------------+
void AddSymbol(const string sym)
  {
   for(int i = 0; i < g_symbolCount; i++) if(g_symbols[i] == sym) return;
   ArrayResize(g_symbols, g_symbolCount + 1);
   g_symbols[g_symbolCount++] = sym;
   SymbolSelect(sym, true);
  }

void RemoveSymbol(const string sym)
  {
   for(int i = 0; i < g_symbolCount; i++)
     {
      if(g_symbols[i] == sym)
        {
         for(int j = i; j < g_symbolCount - 1; j++) g_symbols[j] = g_symbols[j + 1];
         g_symbolCount--;
         ArrayResize(g_symbols, g_symbolCount);
         return;
        }
     }
  }

//+------------------------------------------------------------------+
//| Minimal JSON value extraction (no nested objects required)       |
//+------------------------------------------------------------------+
string JGetStr(const string json, const string key, const string fallback = "")
  {
   string needle = "\"" + key + "\"";
   int k = StringFind(json, needle);
   if(k < 0) return fallback;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return fallback;
   int s = colon + 1;
   while(s < StringLen(json) && (StringGetCharacter(json, s) == ' ' ||
                                  StringGetCharacter(json, s) == '\t' ||
                                  StringGetCharacter(json, s) == '\n')) s++;
   if(s >= StringLen(json)) return fallback;
   if(StringGetCharacter(json, s) != '"') return fallback;
   int e = s + 1;
   string out = "";
   while(e < StringLen(json))
     {
      ushort ch = StringGetCharacter(json, e);
      if(ch == '\\' && e + 1 < StringLen(json))
        {
         ushort nx = StringGetCharacter(json, e + 1);
         if(nx == 'n')      out += "\n";
         else if(nx == 't') out += "\t";
         else if(nx == 'r') out += "\r";
         else               out += ShortToString(nx);
         e += 2;
         continue;
        }
      if(ch == '"') break;
      out += ShortToString(ch);
      e++;
     }
   return out;
  }

double JGetNum(const string json, const string key, const double fallback = 0)
  {
   string needle = "\"" + key + "\"";
   int k = StringFind(json, needle);
   if(k < 0) return fallback;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return fallback;
   int s = colon + 1;
   while(s < StringLen(json) && (StringGetCharacter(json, s) == ' ' ||
                                  StringGetCharacter(json, s) == '\t' ||
                                  StringGetCharacter(json, s) == '\n')) s++;
   int e = s;
   while(e < StringLen(json))
     {
      ushort ch = StringGetCharacter(json, e);
      if(ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\n' || ch == '\t' || ch == '\r') break;
      e++;
     }
   string raw = StringSubstr(json, s, e - s);
   if(StringLen(raw) == 0) return fallback;
   return StringToDouble(raw);
  }

bool JGetBool(const string json, const string key, const bool fallback = false)
  {
   string needle = "\"" + key + "\"";
   int k = StringFind(json, needle);
   if(k < 0) return fallback;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return fallback;
   int s = colon + 1;
   while(s < StringLen(json) && StringGetCharacter(json, s) == ' ') s++;
   string head = StringSubstr(json, s, 4);
   if(head == "true") return true;
   return false;
  }

//+------------------------------------------------------------------+
//| Order execution                                                  |
//+------------------------------------------------------------------+
double NormalizeVolume(const string sym, double v)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double minV = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxV = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(v < minV) v = minV;
   if(v > maxV) v = maxV;
   if(step > 0) v = MathFloor(v / step + 0.5) * step;
   return v;
  }

void HandleOpenOrder(const string json)
  {
   string clientId = JGetStr(json, "clientId");
   string symbol   = JGetStr(json, "symbol");
   string sideStr  = JGetStr(json, "side");
   string kindStr  = JGetStr(json, "kind");
   double volume   = JGetNum(json, "volume");
   double price    = JGetNum(json, "price");
   double slp      = JGetNum(json, "stopLimitPrice");
   double sl       = JGetNum(json, "sl");
   double tp       = JGetNum(json, "tp");
   int    devPts   = (int)JGetNum(json, "deviationPoints", 20);
   string comment  = JGetStr(json, "comment", "supercharts");

   if(StringLen(symbol) == 0 || !SymbolSelect(symbol, true))
     {
      SendOrderResult(clientId, "rejected", 0, 0, 0, 0, "unknown_symbol", symbol, "", "");
      return;
     }
   volume = NormalizeVolume(symbol, volume);
   g_trade.SetDeviationInPoints((ulong)devPts);
   g_trade.SetExpertMagicNumber((long)InpMagic);
   bool ok = false;
   if(kindStr == "market")
     {
      if(sideStr == "buy") ok = g_trade.Buy(volume, symbol, 0, sl, tp, comment);
      else                 ok = g_trade.Sell(volume, symbol, 0, sl, tp, comment);
     }
   else
     {
      ENUM_ORDER_TYPE ot;
      if(kindStr == "limit")
         ot = (sideStr == "buy" ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT);
      else if(kindStr == "stop")
         ot = (sideStr == "buy" ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP);
      else if(kindStr == "stop_limit")
         ot = (sideStr == "buy" ? ORDER_TYPE_BUY_STOP_LIMIT : ORDER_TYPE_SELL_STOP_LIMIT);
      else
        {
         SendOrderResult(clientId, "rejected", 0, 0, 0, 0, "unknown_kind", kindStr, "", "");
         return;
        }
      ok = g_trade.OrderOpen(symbol, ot, volume, slp, price, sl, tp, ORDER_TIME_GTC, 0, comment);
     }
   uint retcode = g_trade.ResultRetcode();
   string retText = g_trade.ResultRetcodeDescription();
   if(ok || retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED)
     {
      ulong ticket = g_trade.ResultDeal();
      if(ticket == 0) ticket = g_trade.ResultOrder();
      string posJ = ticket > 0 ? PositionJson(ticket) : "";
      string ordJ = (StringLen(posJ) == 0 && ticket > 0) ? PendingOrderJson(ticket) : "";
      SendOrderResult(clientId,
                      (retcode == TRADE_RETCODE_PLACED ? "accepted" : "filled"),
                      ticket,
                      g_trade.ResultVolume(),
                      g_trade.ResultPrice(),
                      (int)retcode,
                      retText,
                      comment, posJ, ordJ);
     }
   else
     {
      SendOrderResult(clientId, "rejected", 0, 0, 0, (int)retcode, retText, comment, "", "");
     }
  }

void HandleClose(const string json)
  {
   string clientId   = JGetStr(json, "clientId");
   string positionId = JGetStr(json, "positionId");
   double fraction   = JGetNum(json, "fraction", 1);
   double volExplicit= JGetNum(json, "volume", 0);
   int    devPts     = (int)JGetNum(json, "deviationPoints", 20);
   ulong ticket = (ulong)StringToInteger(positionId);
   if(!g_pos.SelectByTicket(ticket))
     {
      SendOrderResult(clientId, "rejected", 0, 0, 0, 0, "position_not_found", "", "", "");
      return;
     }
   double curVol = g_pos.Volume();
   double closeVol = volExplicit > 0 ? volExplicit : curVol * MathMin(MathMax(fraction, 0), 1);
   closeVol = NormalizeVolume(g_pos.Symbol(), closeVol);
   if(closeVol <= 0)
     {
      SendOrderResult(clientId, "rejected", ticket, 0, 0, 0, "invalid_volume", "", "", "");
      return;
     }
   g_trade.SetDeviationInPoints((ulong)devPts);
   bool ok = g_trade.PositionClosePartial(ticket, closeVol);
   uint retcode = g_trade.ResultRetcode();
   string txt = g_trade.ResultRetcodeDescription();
   string posJ = "";
   if(g_pos.SelectByTicket(ticket)) posJ = PositionJson(ticket);
   if(ok) SendOrderResult(clientId, "filled", ticket, g_trade.ResultVolume(), g_trade.ResultPrice(), (int)retcode, txt, "close", posJ, "");
   else   SendOrderResult(clientId, "rejected", ticket, 0, 0, (int)retcode, txt, "close", posJ, "");
  }

void HandleModify(const string json)
  {
   string clientId       = JGetStr(json, "clientId");
   string positionId     = JGetStr(json, "positionId");
   string pendingOrderId = JGetStr(json, "pendingOrderId");
   double sl             = JGetNum(json, "sl");
   double tp             = JGetNum(json, "tp");
   double price          = JGetNum(json, "price");
   double slp            = JGetNum(json, "stopLimitPrice");
   if(StringLen(positionId) > 0)
     {
      ulong ticket = (ulong)StringToInteger(positionId);
      if(!g_pos.SelectByTicket(ticket))
        {
         SendOrderResult(clientId, "rejected", 0, 0, 0, 0, "position_not_found", "", "", "");
         return;
        }
      bool ok = g_trade.PositionModify(ticket, sl, tp);
      uint retcode = g_trade.ResultRetcode();
      string txt = g_trade.ResultRetcodeDescription();
      string posJ = PositionJson(ticket);
      SendOrderResult(clientId, ok ? "filled" : "rejected", ticket, 0, 0, (int)retcode, txt, "modify", posJ, "");
      return;
     }
   if(StringLen(pendingOrderId) > 0)
     {
      ulong ticket = (ulong)StringToInteger(pendingOrderId);
      if(!g_order.Select(ticket))
        {
         SendOrderResult(clientId, "rejected", 0, 0, 0, 0, "order_not_found", "", "", "");
         return;
        }
      bool ok = g_trade.OrderModify(ticket, price, sl, tp, ORDER_TIME_GTC, 0, slp);
      uint retcode = g_trade.ResultRetcode();
      string txt = g_trade.ResultRetcodeDescription();
      string ordJ = PendingOrderJson(ticket);
      SendOrderResult(clientId, ok ? "accepted" : "rejected", ticket, 0, 0, (int)retcode, txt, "modify", "", ordJ);
     }
  }

void HandleCancel(const string json)
  {
   string clientId = JGetStr(json, "clientId");
   string oid      = JGetStr(json, "pendingOrderId");
   ulong ticket = (ulong)StringToInteger(oid);
   bool ok = g_trade.OrderDelete(ticket);
   uint retcode = g_trade.ResultRetcode();
   string txt = g_trade.ResultRetcodeDescription();
   SendOrderResult(clientId, ok ? "cancelled" : "rejected", ticket, 0, 0, (int)retcode, txt, "cancel", "", "");
  }

void HandleSubscribe(const string json)
  {
   // {"type":"mt5_subscribe_symbols","clientId":"...","symbols":["EURUSD","GBPUSD"]}
   int idx = StringFind(json, "\"symbols\"");
   if(idx < 0) return;
   int lb = StringFind(json, "[", idx);
   int rb = StringFind(json, "]", lb);
   if(lb < 0 || rb < 0) return;
   string body = StringSubstr(json, lb + 1, rb - lb - 1);
   string parts[];
   int n = StringSplit(body, ',', parts);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringReplace(s, "\"", "");
      StringTrimLeft(s);
      StringTrimRight(s);
      if(StringLen(s) == 0) continue;
      AddSymbol(s);
     }
  }

void HandleUnsubscribe(const string json)
  {
   int idx = StringFind(json, "\"symbols\"");
   if(idx < 0) return;
   int lb = StringFind(json, "[", idx);
   int rb = StringFind(json, "]", lb);
   if(lb < 0 || rb < 0) return;
   string body = StringSubstr(json, lb + 1, rb - lb - 1);
   string parts[];
   int n = StringSplit(body, ',', parts);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringReplace(s, "\"", "");
      StringTrimLeft(s);
      StringTrimRight(s);
      if(StringLen(s) == 0) continue;
      RemoveSymbol(s);
     }
  }

//+------------------------------------------------------------------+
//| Inbound message routing                                          |
//+------------------------------------------------------------------+
void HandleMessage(const string json)
  {
   string t = JGetStr(json, "type");
   if(t == "mt5_open")                  HandleOpenOrder(json);
   else if(t == "mt5_close")            HandleClose(json);
   else if(t == "mt5_modify")           HandleModify(json);
   else if(t == "mt5_cancel")           HandleCancel(json);
   else if(t == "mt5_subscribe_symbols")   HandleSubscribe(json);
   else if(t == "mt5_unsubscribe_symbols") HandleUnsubscribe(json);
   else if(t == "mt5_request_snapshot") { SendAccountSnapshot(); SendPositionsSnapshot(); }
   else if(t == "mt5_trailing" || t == "mt5_breakeven")
     {
      // Trailing/BE state is maintained server-side using ticks; ack here.
      string clientId = JGetStr(json, "clientId");
      SendOrderResult(clientId, "accepted", 0, 0, 0, 0, "ack", t, "", "");
     }
   else
     {
      Print("Unknown EA message type: ", t);
     }
  }

//+------------------------------------------------------------------+
//| Inbound buffer drain                                             |
//+------------------------------------------------------------------+
void DrainSocket()
  {
   if(g_socket == INVALID_HANDLE) return;
   uint avail = SocketIsReadable(g_socket);
   while(avail > 0)
     {
      uchar buf[];
      int read = SocketRead(g_socket, buf, (int)avail, 100);
      if(read <= 0) break;
      string chunk = CharArrayToString(buf, 0, read, CP_UTF8);
      g_recvBuffer += chunk;
      avail = SocketIsReadable(g_socket);
     }
   int nl;
   while((nl = StringFind(g_recvBuffer, "\n")) >= 0)
     {
      string line = StringSubstr(g_recvBuffer, 0, nl);
      g_recvBuffer = StringSubstr(g_recvBuffer, nl + 1);
      StringTrimLeft(line);
      StringTrimRight(line);
      if(StringLen(line) > 0) HandleMessage(line);
     }
  }

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit()
  {
   EventSetMillisecondTimer(250);
   string defs[];
   int n = StringSplit(InpDefaultSymbols, ',', defs);
   for(int i = 0; i < n; i++)
     {
      string s = defs[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(StringLen(s) > 0) AddSymbol(s);
     }
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   CloseSocket();
  }

void OnTimer()
  {
   if(!ConnectIfNeeded()) return;
   if(!g_helloSent)       SendHello();

   ulong now = NowMs();
   if(now - g_lastAccountFlushMs >= (ulong)InpAccountSnapshotMs)
     {
      SendAccountSnapshot();
      g_lastAccountFlushMs = now;
     }
   if(now - g_lastPositionFlushMs >= (ulong)InpPositionSnapshotMs)
     {
      SendPositionsSnapshot();
      g_lastPositionFlushMs = now;
     }
   if(now - g_lastHeartbeatMs >= (ulong)InpHeartbeatSec * 1000)
     {
      SendHeartbeat();
      g_lastHeartbeatMs = now;
     }
   for(int i = 0; i < g_symbolCount; i++) SendTick(g_symbols[i]);
   if(InpStreamAllTicks)
     {
      int total = SymbolsTotal(true);
      for(int i = 0; i < total; i++) SendTick(SymbolName(i, true));
     }
   FlushOutgoing();
   DrainSocket();
  }

void OnTick()
  {
   // Slow path tick handler — most work happens in OnTimer so we keep this lean.
   if(!ConnectIfNeeded()) return;
   FlushOutgoing();
   DrainSocket();
  }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
  {
   // Broker-driven events (SL hit, TP hit, manual close in terminal). Push
   // the latest positions snapshot so the server can reflect the change.
   SendPositionsSnapshot();
   SendAccountSnapshot();
  }
//+------------------------------------------------------------------+
