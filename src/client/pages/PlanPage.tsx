import { Alert, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, PageHeader } from '../components/common';
import { ConfirmPlanDialog } from '../components/ConfirmPlanDialog';
import { PlanView } from '../components/PlanView';
import { useLoad, useToast } from '../hooks';

/** Cutting plan detail for a preview (not yet confirmed). */
export function PlanPage(): ReactElement {
  const { runId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const run = useLoad(() => api.runs.get(runId), [runId]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = run.data;
  const plans = data?.result.plans ?? [];
  const plan = plans.find((p) => p.id === search.get('plan')) ?? plans[0];

  const confirm = async (approved: string[]): Promise<void> => {
    if (!data || !plan) return;
    setBusy(true);
    try {
      const job = await api.runs.confirm(data.id, { planId: plan.id, approvedOffcuts: approved });
      toast('İş onaylandı; stok güncellendi.');
      navigate(`/gecmis/${job.id}`);
    } catch (e) {
      setConfirmOpen(false);
      setError(e instanceof Error ? e.message : 'Onaylanamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Kesim Planı Detayı"
        subtitle={data ? data.orderName : undefined}
        actions={<Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/yeni-is')}>Yeni işe dön</Button>}
      />
      <ErrorNote message={run.error ?? error} />
      {run.loading && <LinearProgress />}
      {data && plan && (
        <PlanView
          plan={plan}
          input={data.input}
          settings={data.settings}
          meta={data.result}
          actions={
            <Paper sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                {data.confirmedJobId !== null ? (
                  <Alert severity="success" sx={{ flex: 1 }}>Bu plan onaylandı. <Button size="small" onClick={() => navigate(`/gecmis/${data.confirmedJobId}`)}>İş kaydını aç</Button></Alert>
                ) : (
                  <>
                    <Button variant="contained" onClick={() => setConfirmOpen(true)} disabled={plan.sheets.length === 0} data-testid="open-confirm">Planı onayla ve stoktan düş…</Button>
                    <Typography variant="body2" color="text.secondary">Bu bir önizlemedir; onaylayana kadar envanter değişmez.</Typography>
                  </>
                )}
              </Stack>
              <ConfirmPlanDialog open={confirmOpen} plan={plan} input={data.input} busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={(a) => void confirm(a)} />
            </Paper>
          }
        />
      )}
    </>
  );
}
