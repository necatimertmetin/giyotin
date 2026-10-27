import { Alert, Autocomplete, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_SETTINGS, type CuttingSettings } from '../../engine';
import { marginText } from '../labels';
import { materialLabelOf, type OrderDto, type RunDto } from '../../shared/api';
import { api } from '../api';
import { ErrorNote, PageHeader } from '../components/common';
import { ConfirmPlanDialog } from '../components/ConfirmPlanDialog';
import { fromDto, isValid, newLine, OrderEditor, toDto, type DraftLine } from '../components/OrderEditor';
import { PlanComparison, planName } from '../components/PlanComparison';
import { PlanView } from '../components/PlanView';
import { SettingsStep } from '../components/SettingsStep';
import { fmtDuration, fmtNum } from '../format';
import { useLoad, useToast } from '../hooks';
import { issueText } from '../labels';

/** Search effort is not a user setting: a wide beam and a generous time limit always apply. */
const SEARCH = { searchWidth: 6, maxRuntimeMs: 8000 } as const;

export function NewJobPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const stock = useLoad(api.stock.list);
  const orders = useLoad(api.orders.list);
  const profiles = useLoad(api.profiles.list);

  const [settings, setSettings] = useState<CuttingSettings>(DEFAULT_SETTINGS);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [orderName, setOrderName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [run, setRun] = useState<RunDto | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.settings.get().then(setSettings).catch(() => undefined);
  }, []);

  const materials = useMemo(() => {
    const m = new Map<string, string>();
    (stock.data ?? []).forEach((s) => m.set(s.materialKey, materialLabelOf(s)));
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  }, [stock.data]);

  const valid = lines.length > 0 && lines.every(isValid);

  // Any change to the order or the settings makes a shown result out of date.
  const signature = JSON.stringify([lines.map(toDto), settings]);
  const ranSignature = useRef<string | null>(null);
  const optimizeRef = useRef<() => Promise<void>>(async () => undefined);
  const outdated = run !== null && ranSignature.current !== signature;
  // Plans are calculated as soon as the order is valid and again whenever the order or a setting changes.
  useEffect(() => {
    if (!valid || ranSignature.current === signature) return;
    const t = setTimeout(() => void optimizeRef.current(), run ? 900 : 150);
    return () => clearTimeout(t);
  }, [signature, valid, run]);

  const loadOrder = (o: OrderDto | null): void => {
    setRun(null);
    ranSignature.current = null;
    setOrderId(o?.id ?? null);
    setOrderName(o?.name ?? '');
    setOrderNotes(o?.notes ?? '');
    setLines(o ? o.lines.map(fromDto) : [newLine()]);
  };

  const optimize = async (): Promise<void> => {
    if (!valid) {
      setError('Önce sipariş satırlarındaki hataları düzeltin (ürün adı, ölçüler ve adet gerekli).');
      return;
    }
    ranSignature.current = signature;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      const result = await api.optimize({ orderId, lines: lines.map(toDto), settings: { ...settings, ...SEARCH } }, controller.signal);
      setRun(result);
      setSelectedPlan(result.result.plans[0]?.id ?? '');
      // The last used settings become the starting point of the next job.
      api.settings.save(settings).catch(() => undefined);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Optimizasyon başarısız oldu.');
    } finally {
      if (abortRef.current === controller) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  };

  const saveOrder = async (): Promise<void> => {
    if (!orderName.trim()) return setError('Siparişi kaydetmek için bir ad girin.');
    if (!valid) return setError('Kaydetmeden önce satırlardaki hataları düzeltin.');
    try {
      const body = { name: orderName.trim(), notes: orderNotes.trim() || null, lines: lines.map(toDto) };
      const saved = orderId ? await api.orders.update(orderId, body) : await api.orders.create(body);
      setOrderId(saved.id);
      setError(null);
      toast('Sipariş kaydedildi.');
      orders.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.');
    }
  };

  const deleteOrder = async (): Promise<void> => {
    if (!orderId) return;
    await api.orders.remove(orderId);
    toast('Sipariş silindi.');
    loadOrder(null);
    orders.reload();
  };

  optimizeRef.current = optimize;

  const plan = run?.result.plans.find((p) => p.id === selectedPlan) ?? run?.result.plans[0];
  const pieceNames = new Map(run?.input.pieces.map((p) => [p.id, p.name]) ?? []);

  const confirm = async (approved: string[]): Promise<void> => {
    if (!run || !plan) return;
    setConfirming(true);
    try {
      const job = await api.runs.confirm(run.id, { planId: plan.id, approvedOffcuts: approved });
      toast('İş onaylandı; stok güncellendi.');
      navigate(`/gecmis/${job.id}`);
    } catch (e) {
      setConfirmOpen(false);
      setError(e instanceof Error ? e.message : 'Onaylanamadı.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <PageHeader title="Yeni Kesim İşi" subtitle="Siparişi girin, kesim ayarlarını örnek kalıpta görerek belirleyin ve planları karşılaştırın. Önizleme stoğu değiştirmez; yalnızca onayladığınızda stok düşülür." />
      <ErrorNote message={error} />

      <Stack spacing={3}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <Autocomplete
              sx={{ minWidth: 300 }}
              options={orders.data ?? []}
              value={orders.data?.find((o) => o.id === orderId) ?? null}
              getOptionLabel={(o) => o.name}
              onChange={(_, o) => loadOrder(o)}
              renderInput={(params) => <TextField {...params} label="Kayıtlı siparişler" placeholder="Seçin veya aşağıdan yeni girin" inputProps={{ ...params.inputProps, 'data-testid': 'order-select' }} />}
              noOptionsText="Kayıtlı sipariş yok"
            />
            <TextField label="Sipariş adı" value={orderName} onChange={(e) => setOrderName(e.target.value)} sx={{ flex: 1 }} inputProps={{ 'data-testid': 'order-name' }} />
            <TextField label="Not" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} sx={{ flex: 1 }} />
            <Button startIcon={<SaveIcon />} variant="outlined" color="secondary" onClick={saveOrder} data-testid="save-order">Kaydet</Button>
            {orderId && <Button startIcon={<DeleteIcon />} color="error" onClick={deleteOrder}>Sil</Button>}
          </Stack>
          <OrderEditor lines={lines} onChange={setLines} stock={stock.data ?? []} materials={materials} settings={settings} />
          <Stack direction="row" justifyContent="space-between">
            <Button startIcon={<AddIcon />} onClick={() => setLines([...lines, newLine()])} data-testid="add-line">Ürün satırı ekle</Button>
          </Stack>
        </Stack>

        <SettingsStep
          settings={settings}
          onChange={setSettings}
          profiles={profiles.data ?? []}
          onProfilesChanged={profiles.reload}
          running={running}
          onRun={() => void optimize()}
          onCancel={() => abortRef.current?.abort()}
          planCount={run?.result.plans.length ?? 0}
          results={
            run && plan ? (
              <Box data-testid="results">
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Kerf {fmtNum(run.settings.kerf)} mm · kenar payı {marginText(run.settings)}{run.settings.bladeLength ? ` · bıçak ${fmtNum(run.settings.bladeLength)} mm` : ''} · hesaplama {fmtDuration(run.result.runtimeMs)}
                </Typography>
                {(outdated || running) && <Alert severity="info" sx={{ mb: 2 }}>{running ? 'Ayarlar değişti; planlar yeniden hesaplanıyor…' : 'Sipariş veya ayarlar değişti; gösterilen plan güncel değil.'}</Alert>}
                {run.result.issues.length > 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }} data-testid="issues">
                    <b>Siparişte sorunlar var:</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      {run.result.issues.map((i) => <li key={`${i.pieceId}-${i.kind}`}>{issueText(i, pieceNames.get(i.pieceId) ?? i.pieceId)}</li>)}
                    </ul>
                  </Alert>
                )}
                <PlanComparison plans={run.result.plans} selectedId={plan.id} onSelect={setSelectedPlan} horizontal />
                <Box sx={{ mt: 2, minWidth: 0 }} data-testid="plan-detail">
                  <Typography variant="h6" sx={{ mb: 1 }}>{planName(run.result.plans, plan.id)} — nasıl kesilecek?</Typography>
                  <PlanView
                    plan={plan}
                    input={run.input}
                    settings={run.settings}
                    meta={run.result}
                    stacked
                    actions={
                      <Paper sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button variant="contained" onClick={() => setConfirmOpen(true)} disabled={plan.sheets.length === 0 || outdated || running || run.confirmedJobId !== null} data-testid="open-confirm">Bu planı onayla…</Button>
                        <Button variant="outlined" color="secondary" onClick={() => navigate(`/plan/${run.id}?plan=${plan.id}`)} disabled={plan.sheets.length === 0} data-testid="open-plan">Tam sayfa aç</Button>
                        <Typography variant="body2" color="text.secondary">Onaylamadan önce stok değişmez.</Typography>
                      </Paper>
                    }
                  />
                </Box>
                <ConfirmPlanDialog open={confirmOpen} plan={plan} input={run.input} busy={confirming} onClose={() => setConfirmOpen(false)} onConfirm={(a) => void confirm(a)} />
              </Box>
            ) : null
          }
        />
      </Stack>
    </>
  );
}
