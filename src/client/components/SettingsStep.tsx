import { Box, Button, CircularProgress, IconButton, Paper, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { CuttingSettings } from '../../engine';
import type { SettingsProfileDto, StockItemDto } from '../../shared/api';
import { NumberField } from './common';
import type { DraftLine } from './OrderEditor';
import { ProfileBar } from './ProfileBar';
import { SamplePreview } from './SamplePreview';
import { KerfIllustration, MarginIllustration, OffcutIllustration } from './SettingIllustrations';

interface Props {
  settings: CuttingSettings;
  onChange: (s: CuttingSettings) => void;
  profiles: SettingsProfileDto[];
  onProfilesChanged: () => void;
  lines: DraftLine[];
  stock: StockItemDto[];
  running: boolean;
  onBack: () => void;
  onRun: () => void;
  onCancel: () => void;
  /** Rendered in the "Planlar" tab once an optimisation has run; null before that. */
  results: ReactNode | null;
  /** True once a result exists; the first result switches to the plans tab. */
  hasResult: boolean;
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
export function SettingsStep({ settings, onChange, profiles, onProfilesChanged, lines, stock, running, onBack, onRun, onCancel, results, hasResult, planCount }: Props): ReactElement {
  const set = (patch: Partial<CuttingSettings>): void => onChange({ ...settings, ...patch });
  const trimOn = settings.edgeMargin > 0;
  const [tab, setTab] = useState<'sample' | 'plans'>('sample');

  useEffect(() => {
    if (hasResult) setTab('plans');
  }, [hasResult]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
        <Box>
          <Typography variant="h5">Kesim ayarları ve planlar</Typography>
          <Typography color="text.secondary">Planlar otomatik hesaplanır; soldaki ayarı değiştirdikçe sağdaki örnek kesim ve alternatif planlar güncellenir.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button onClick={onBack} data-testid="back-to-order">← Siparişe dön</Button>
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
            <MarginIllustration margin={settings.edgeMargin} />
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }}>
              <ToggleButtonGroup exclusive size="small" value={trimOn ? 'on' : 'off'} onChange={(_, v: string | null) => v && set({ edgeMargin: v === 'on' ? 5 : 0 })}>
                <ToggleButton value="off" sx={{ px: 2 }} data-testid="trim-off">Kırpma yok</ToggleButton>
                <ToggleButton value="on" sx={{ px: 2 }} data-testid="trim-on">Kırp</ToggleButton>
              </ToggleButtonGroup>
              {trimOn && <NumberField value={settings.edgeMargin} onChange={(v) => set({ edgeMargin: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 110 }} inputProps={{ 'aria-label': 'Kenar payı' }} />}
            </Stack>
          </Card>

          <Card n={3} title="En küçük saklanacak artık" hint="Her kenarı bundan küçük kalanlar fire olur.">
            <OffcutIllustration w={settings.minOffcutWidth} h={settings.minOffcutHeight} />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <NumberField value={settings.minOffcutWidth} onChange={(v) => set({ minOffcutWidth: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 120 }} inputProps={{ 'aria-label': 'Min. artık genişliği', 'data-testid': 'setting-min-offcut' }} />
              <Typography>×</Typography>
              <NumberField value={settings.minOffcutHeight} onChange={(v) => set({ minOffcutHeight: Math.max(0, v ?? 0) })} unit="mm" sx={{ width: 120 }} inputProps={{ 'aria-label': 'Min. artık yüksekliği' }} />
            </Stack>
          </Card>
        </Stack>

        <Box sx={{ minWidth: 0 }}>
          <Tabs value={tab} onChange={(_, v: 'sample' | 'plans') => setTab(v)} sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="sample" label="Örnek kesim" data-testid="tab-sample" />
            <Tab
              value="plans"
              disabled={!results}
              data-testid="tab-plans"
              label={planCount > 0 ? `Alternatif planlar (${planCount})` : 'Alternatif planlar'}
            />
          </Tabs>
          <Box sx={{ display: tab === 'sample' ? 'block' : 'none' }}>
            <SamplePreview lines={lines} stock={stock} settings={settings} />
          </Box>
          {tab === 'plans' && results}
        </Box>
      </Box>
    </Stack>
  );
}
