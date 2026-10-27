import { Button, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import { useEffect, useState, type ReactElement } from 'react';
import { collectCuts, type SheetPlan } from '../../engine';
import { describeCut } from './cutText';

interface Props {
  sheet: SheetPlan;
  /** Cuts made so far; null = the finished layout, no animation. */
  step: number | null;
  onStep: (step: number | null) => void;
}

/** Time between two cuts while playing; the pieces glide apart a little faster than that. */
const TICK_MS = 850;

/** Play / pause and step controls that sit in a corner of the sheet preview. */
export function CutPlayer({ sheet, step, onStep }: Props): ReactElement | null {
  const cuts = collectCuts(sheet.tree);
  const total = cuts.length;
  const [playing, setPlaying] = useState(false);

  // A different sheet starts over.
  useEffect(() => setPlaying(false), [sheet]);

  useEffect(() => {
    if (!playing || step === null) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => onStep(step + 1), TICK_MS);
    return () => clearTimeout(t);
  }, [playing, step, total, onStep]);

  if (total === 0) return null;

  const at = step ?? 0;
  const finished = step !== null && step >= total;

  const play = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (step === null || finished) onStep(0);
    setPlaying(true);
  };
  const go = (to: number): void => {
    setPlaying(false);
    onStep(Math.min(total, Math.max(0, to)));
  };

  return (
    <Paper elevation={3} sx={{ p: 1, width: 320 }} data-testid="cut-stepper" onPointerDown={(e) => e.stopPropagation()}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button
          variant="contained"
          color={playing ? 'warning' : 'success'}
          startIcon={playing ? <PauseIcon /> : <PlayArrowIcon />}
          onClick={play}
          sx={{ minWidth: 118, fontWeight: 700 }}
          data-testid="step-play"
        >
          {playing ? 'Duraklat' : finished ? 'Tekrar' : 'Oynat'}
        </Button>
        <Tooltip title="Geri"><span><IconButton size="small" aria-label="Geri" disabled={step === null || step === 0} onClick={() => go(at - 1)}><NavigateBeforeIcon /></IconButton></span></Tooltip>
        <Tooltip title="İleri"><span><IconButton size="small" aria-label="İleri" disabled={finished} onClick={() => go(at + 1)} data-testid="step-next"><NavigateNextIcon /></IconButton></span></Tooltip>
        <Tooltip title="Bitmiş kalıbı göster"><span><IconButton size="small" aria-label="Sıfırla" disabled={step === null} onClick={() => { setPlaying(false); onStep(null); }}><ReplayIcon /></IconButton></span></Tooltip>
        <Typography variant="caption" sx={{ ml: 'auto !important', whiteSpace: 'nowrap' }} data-testid="step-counter">
          {step === null ? `${total} kesim` : `Adım ${step} / ${total}`}
        </Typography>
      </Stack>
      {step !== null && <LinearProgress variant="determinate" value={(at / total) * 100} sx={{ height: 4, borderRadius: 2, mt: 0.75 }} />}
    </Paper>
  );
}

/** What the cut that was just made is, in words; shown under the preview while the animation runs. */
export function CutCaption({ sheet, kerf, step }: { sheet: SheetPlan; kerf: number; step: number | null }): ReactElement | null {
  const cut = step !== null && step > 0 ? collectCuts(sheet.tree)[step - 1] : undefined;
  if (!cut) return null;
  const d = describeCut(cut, kerf);
  return (
    <Typography variant="body2" sx={{ mt: 1 }} data-testid="step-description">
      <b>Kesim #{cut.sequence} — {d.title}.</b> {d.instruction}
    </Typography>
  );
}
