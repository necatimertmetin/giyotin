import { Alert, Box, InputAdornment, Stack, TextField, Typography, type TextFieldProps } from '@mui/material';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { parseNum } from '../format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }): ReactElement {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'flex-end' }} spacing={1.5} sx={{ mb: 3 }}>
      <Box>
        <Typography variant="h4" component="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{actions}</Stack>}
    </Stack>
  );
}

export function ErrorNote({ message }: { message: string | null }): ReactElement | null {
  return message ? <Alert severity="error" sx={{ mb: 2 }}>{message}</Alert> : null;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): ReactElement {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      <Typography variant="h6" color="text.primary">{title}</Typography>
      {hint && <Typography sx={{ mt: 0.5 }}>{hint}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

type NumberFieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
};

/** Text field that accepts Turkish decimal commas ("12,5") and reports a number or null. */
export function NumberField({ value, onChange, unit, inputProps, ...rest }: NumberFieldProps): ReactElement {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const parsed = parseNum(text);
    const current = Number.isNaN(parsed) ? null : parsed;
    if (current !== value) setText(value === null ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextField
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNum(e.target.value);
        onChange(Number.isNaN(n) ? null : n);
      }}
      inputProps={{ inputMode: 'decimal', ...inputProps }}
      InputProps={{ endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined }}
    />
  );
}
