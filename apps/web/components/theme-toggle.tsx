'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-provider';
import { getSkin } from '@/lib/skins';
import { Button } from './ui/button';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggle}
      aria-label="Toggle theme"
      className="text-muted-foreground hover:text-foreground"
    >
      {getSkin(theme).family === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
