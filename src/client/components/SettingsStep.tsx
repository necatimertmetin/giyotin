import { Box, Button, CircularProgress, IconButton, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { type ReactElement, type ReactNode } from 'react';
import { edgeMarginsOf, type CuttingSettings, type EdgeMargins } from '../../engine';
import type { SettingsProfileDto } from '../../shared/api';
import { Link } from 'react-router-dom';
import { fmtNum } from '../format';
import { NumberField } from './common';
import { ProfileBar } from './ProfileBar';
import { KerfIllustration, MarginIllustration, OffcutIllustration } from './SettingIllustrations';

interface Props {
  settings: CuttingSettings;
  /** Name of the configured guillotine; its blade length is already in `settings`. */
  machineName: string | null;
  onChange: (s: CuttingSettings) => void;
  profiles: SettingsProfileDto[];
  onProfilesChanged: () => void;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** Rendered in the "Planlar" tab once an optimisation has run; null before that. */
  results: ReactNode | null;
  planCount: number;
}

function Card({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }): ReactElement {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography sx={{ fontWeight: 700 }}>{n} · {title}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{hint}</Typography>
      {children}
    </Paper>
  );
}

/** Settings on the left; on the right a live sample sheet and, after a run, the alternative plans. */
export function SettingsStep({ settings, machineName, onChange, profiles, onProfilesChanged, running, onRun, onCancel, results, planCount }: Props): ReactElement {
  const set = (patch: Partial<CuttingSettings>): void => onChange({ ...settings, ...patch });
  const margins = edgeMarginsOf(settings);
  const blade = settings.bladeLength ?? 0;
  const trimMode: 'off' | 'on' | 'edges' = settings.edgeMargins ? 'edges' : settings.edgeMargin > 0 ? 'on' : 'off';
  const setEdge = (edge: keyof EdgeMargins, v: number | null): void => set({ edgeMargins: { ...margins, [edge]: Math.max(0, v ?? 0) } });
  const setTrimMode = (v: 'off' | 'on' | 'edges'): void => {
    if (v === 'edges') set({ edgeMargins: { ...margins, ...(trimMode === 'off' ? { top: 5, right: 5, bottom: 5, left: 5 } : {}) } });
    else set({ edgeMargins: undefined, edgeMargin: v === 'on' ? (settings.edgeMargin > 0 ? settings.edgeMargin : 5) : 0 });
  };
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
        <Box>
          <Typography variant="h5">Kesim ayarları ve planlar</Typography>
          <Typography color="text.secondary">Planlar otomatik hesaplanır; soldaki ayarı değiştirdikçe sağdaki örnek kesim ve alternatif planlar güncellenir.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {running && <Button color="inherit" onClick={onCancel} data-testid="cancel-run">İptal</Button>}
          <Button variant="contained" size="large" onClick={onRun} disabled={running} startIcon={running ? <CircularProgress size={18} color="inherit" /> : undefined} data-testid="run-optimizer">
            {running ? 'Hesaplanıyor…' : 'Yeniden hesapla'}
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
        <Stack spacing={1.5}>
          <ProfileBar settings={settings} profiles={profiles} onApply={onChange} onChanged={onProfilesChanged} />

          <Card n={1} title="Bıçak kalınlığı" hint="Her kesimde kağıttan giden şerit (siyah çizgiler).">
            <KerfIllustration kerf={settings.kerf} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
              <Stack direction="row" alignItems="center" sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <IconButton aria-label="Bıçak payını azalt" onClick={() => set({ kerf: Math.max(0, Math.round((settings.kerf - 0.5) * 100) / 100) })}><RemoveIcon /></IconButton>
                <NumberField value={settings.kerf} onChange={(v) => set({ kerf: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 104 }} inputProps={{ 'aria-label': 'Bıçak payı', 'data-testid': 'setting-kerf', style: { textAlign: 'center', fontWeight: 700 } }} />
                <IconButton aria-label="Bıçak payını artır" onClick={() => set({ kerf: Math.min(50, Math.round((settings.kerf + 0.5) * 100) / 100) })}><AddIcon /></IconButton>
              </Stack>
              <Typography variant="caption" color="text.secondary" align="right">Giyotinlerde genelde<br /><b>2–3 mm</b></Typography>
            </Stack>
          </Card>

          <Card n={2} title="Tabaka kenarları" hint="Kenardan kırpılıp atılan şerit (fire sayılır).">
            <MarginIllustration margins={margins} />
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }}>
              <ToggleButtonGroup exclusive size="small" value={trimMode} onChange={(_, v: 'off' | 'on' | 'edges' | null) => v && setTrimMode(v)}>
                <ToggleButton value="off" sx={{ px: 1.5 }} data-testid="trim-off">Kırpma yok</ToggleButton>
                <ToggleButton value="on" sx={{ px: 1.5 }} data-testid="trim-on">Her kenar</ToggleButton>
                <ToggleButton value="edges" sx={{ px: 1.5 }} data-testid="trim-edges">Kenar kenar</ToggleButton>
              </ToggleButtonGroup>
              {trimMode === 'on' && <NumberField value={settings.edgeMargin} onChange={(v) => set({ edgeMargin: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 110 }} inputProps={{ 'aria-label': 'Kenar payı' }} />}
            </Stack>
            {trimMode === 'edges' && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1.5 }} data-testid="edge-margins">
                {([['top', 'Üst'], ['right', 'Sağ'], ['bottom', 'Alt'], ['left', 'Sol']] as const).map(([edge, label]) => (
                  <Stack key={edge} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ width: 28 }}>{label}</Typography>
                    <NumberField value={margins[edge]} onChange={(v) => setEdge(edge, v)} unit="mm" sx={{ width: 110 }} inputProps={{ 'aria-label': `${label} kenar payı`, 'data-testid': `edge-${edge}` }} />
                  </Stack>
                ))}
              </Box>
            )}
          </Card>

          <Card n={3} title="Giyotin bıçak boyu" hint="Bir kesim en fazla bu uzunlukta olabilir; bundan geniş bir kağıt tek hamlede kesilemez.">
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
              <Typography data-testid="machine-blade-info">
                <b>{blade > 0 ? `${fmtNum(blade)} mm` : 'Girilmedi'}</b>
                {machineName && <Typography component="span" color="text.secondary"> · {machineName}</Typography>}
              </Typography>
              <Button component={Link} to="/ayarlar" size="small">Ayarlar'da değiştir</Button>
            </Stack>
          </Card>

          <Card n={4} title="En küçük saklanacak artık" hint="Her kenarı bundan küçük kalanlar fire olur.">
            <OffcutIllustration w={settings.minOffcutWidth} h={settings.minOffcutHeight} />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <NumberField value={settings.minOffcutWidth} onChange={(v) => set({ minOffcutWidth: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 120 }} inputProps={{ 'aria-label': 'Min. artık genişliği', 'data-testid': 'setting-min-offcut' }} />
              <Typography>×</Typography>
              <NumberField value={settings.minOffcutHeight} onChange={(v) => set({ minOffcutHeight: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 120 }} inputProps={{ 'aria-label': 'Min. artık yüksekliği' }} />
            </Stack>
          </Card>
        </Stack>

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>{planCount > 0 ? `Alternatif planlar (${planCount})` : 'Alternatif planlar'}</Typography>
          {results ?? (
            <Paper sx={{ p: 3, display: 'flex', gap: 1.5, alignItems: 'center' }}>
              {running && <CircularProgress size={20} />}
              <Typography color="text.secondary">{running ? 'Planlar hesaplanıyor…' : 'Planları görmek için siparişteki ürün satırlarını eksiksiz doldurun.'}</Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </Stack>
  );
}
