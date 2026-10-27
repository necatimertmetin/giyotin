import { Alert, Box, Button, IconButton, LinearProgress, Slider, Stack, Tooltip, Typography } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import { useEffect, useState, type ReactElement } from 'react';
import { collectCuts, type SheetPlan } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtNum } from '../format';
import { describeCut } from './cutText';

interface Props {
  sheet: SheetPlan;
  kerf: number;
  step: number;
  onStep: (step: number) => void;
}

/** Shop-floor mode: walks through the cuts in the exact order given by the cut tree. */
export function CutStepper({ sheet, kerf, step, onStep }: Props): ReactElement {
  const cuts = collectCuts(sheet.tree);
  const total = cuts.length;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => onStep(step + 1), 900);
    return () => clearTimeout(t);
  }, [playing, step, total, onStep]);

  const current = step > 0 ? cuts[step - 1] : undefined;
  const d = current ? describeCut(current, kerf) : null;
  const margin = sheet.usable.x;

  return (
    <Stack spacing={1.5} data-testid="cut-stepper">
      {total === 0 ? (
        <Alert severity="info">Bu kalıpta kesim gerekmiyor.</Alert>
      ) : (
        <>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="h6" data-testid="step-counter">Adım {step} / {total}</Typography>
              <Typography variant="caption" color="text.secondary">{fmtNum((step / total) * 100, 0)}%</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={(step / total) * 100} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              color={playing ? 'warning' : 'success'}
              size="large"
              startIcon={playing ? <PauseIcon /> : <PlayArrowIcon />}
              disabled={step >= total && !playing}
              onClick={() => setPlaying((p) => !p)}
              sx={{ minWidth: 132, fontWeight: 700 }}
              data-testid="step-play"
            >
              {playing ? 'Duraklat' : 'Oynat'}
            </Button>
            <Tooltip title="Başa dön"><span><IconButton aria-label="Başa dön" onClick={() => { setPlaying(false); onStep(0); }} disabled={step === 0}><FirstPageIcon /></IconButton></span></Tooltip>
            <Button variant="outlined" startIcon={<NavigateBeforeIcon />} disabled={step === 0} onClick={() => { setPlaying(false); onStep(step - 1); }}>Geri</Button>
            <Button variant="outlined" endIcon={<NavigateNextIcon />} disabled={step >= total} onClick={() => { setPlaying(false); onStep(step + 1); }} data-testid="step-next">İleri</Button>
          </Stack>
          <Slider size="small" min={0} max={total} step={1} value={step} onChange={(_, v) => { setPlaying(false); onStep(v as number); }} aria-label="Kesim adımı" />
          {step === 0 && (
            <Alert severity="info" icon={false}>
              {margin > 0 ? `Önce kağıdın dört kenarından ${fmtNum(margin)} mm kenar payını kesip atın. ` : ''}
              İlk kesimi görmek için “İleri”ye basın.
            </Alert>
          )}
          {current && d && (
            <Alert severity="warning" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }} data-testid="step-description">
              <Typography variant="subtitle2" sx={{ color: 'inherit' }}>Kesim #{current.sequence} — {d.title}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>{d.instruction}</Typography>
              {d.results.map((r) => (
                <Typography key={r} variant="body2" sx={{ fontFamily: FONT_MONO, fontSize: '0.8rem' }}>→ {r}</Typography>
              ))}
            </Alert>
          )}
          {sheet.copies > 1 && (
            <Alert severity="info" icon={false}>Bu kalıp aynı şekilde <b>{sheet.copies}</b> tabakada tekrarlanacak.</Alert>
          )}
        </>
      )}
    </Stack>
  );
}
