import { createTheme } from '@mui/material/styles';

export const ACCENT = '#c2410c';
export const GRAPHITE = '#1f2933';

export const FONT_MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, "SFMono-Regular", Menlo, monospace';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: ACCENT, dark: '#9a3412', light: '#ea580c', contrastText: '#ffffff' },
    secondary: { main: GRAPHITE },
    background: { default: '#eef0f3', paper: '#ffffff' },
    text: { primary: '#111827', secondary: '#4b5563' },
    divider: '#d5d9df',
    success: { main: '#15803d' },
    warning: { main: '#b45309' },
    error: { main: '#b91c1c' },
    info: { main: '#1d4ed8' },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: '"Segoe UI", "Inter", system-ui, -apple-system, Roboto, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.75rem' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em', fontSize: '1.35rem' },
    h6: { fontWeight: 650, fontSize: '1.05rem' },
    subtitle2: { fontWeight: 650, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.72rem', color: '#4b5563' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: '#4b5563', backgroundColor: '#f7f8fa' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiChip: { styleOverrides: { root: { borderRadius: 3, fontWeight: 600 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
