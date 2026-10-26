import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useState, type ReactElement } from 'react';
import type { StockItemDto } from '../../shared/api';
import { api } from '../api';
import { ErrorNote, PageHeader } from '../components/common';
import { Metric } from '../components/PlanStats';
import { StockDialog } from '../components/StockDialog';
import { StockTable } from '../components/StockTable';
import { fmtArea, fmtInt } from '../format';
import { useLoad, useToast } from '../hooks';

/** Reusable offcut inventory, kept separate from full sheets. */
export function OffcutsPage(): ReactElement {
  const stock = useLoad(api.stock.list);
  const papers = useLoad(api.papers.list);
  const toast = useToast();
  const [editing, setEditing] = useState<StockItemDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<StockItemDto | null>(null);

  const offcuts = (stock.data ?? []).filter((s) => s.kind === 'offcut');
  const usable = offcuts.filter((o) => o.status === 'active' && o.quantity > 0);
  const area = (list: StockItemDto[]): number => list.reduce((a, o) => a + o.width * o.height * o.quantity, 0);

  return (
    <>
      <PageHeader
        title="Artık Parçalar"
        subtitle="Önceki işlerden kalan, gerçek dikdörtgen artıklar. Bu parçalar bir sonraki optimizasyonda otomatik olarak stok sayılır; farklı kağıt cinsleri asla birleştirilmez. Hasarlı veya ayrılmış parçaları kullanım dışı bırakabilirsiniz."
        actions={<Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true); }}>Artık ekle</Button>}
      />
      <ErrorNote message={stock.error} />
      {stock.loading && !stock.data && <LinearProgress />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5, mb: 2 }}>
        <Metric label="Kayıt" value={fmtInt(offcuts.length)} />
        <Metric label="Kullanılabilir adet" value={fmtInt(usable.reduce((a, o) => a + o.quantity, 0))} tone="good" />
        <Metric label="Kullanılabilir alan" value={fmtArea(area(usable))} tone="good" />
        <Metric label="Hariç tutulan alan" value={fmtArea(area(offcuts.filter((o) => o.status === 'excluded')))} />
      </Box>
      {stock.data && offcuts.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>Henüz artık parça yok. Bir kesim işini onayladıktan sonra, oluşan artıkları geçmiş sayfasından envantere ekleyebilirsiniz.</Typography>
      )}
      {stock.data && (
        <StockTable
          items={offcuts}
          kind="offcut"
          onEdit={(s) => { setEditing(s); setDialogOpen(true); }}
          onDelete={setDeleting}
          onToggleStatus={async (s, active) => {
            try {
              await api.stock.update(s.id, { status: active ? 'active' : 'excluded' });
              toast(active ? 'Artık parça tekrar kullanıma açıldı.' : 'Artık parça kullanım dışı bırakıldı.');
              stock.reload();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Güncellenemedi.', 'error');
            }
          }}
        />
      )}
      <StockDialog open={dialogOpen} kind="offcut" initial={editing} customPapers={papers.data ?? []} onClose={() => setDialogOpen(false)} onSaved={stock.reload} />
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Artık parça silinsin mi?</DialogTitle>
        <DialogContent><DialogContentText>Kayıt envanterden kaldırılır; geçmiş işler etkilenmez.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button color="error" variant="contained" onClick={async () => { if (deleting) { await api.stock.remove(deleting.id); stock.reload(); } setDeleting(null); }}>Sil</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
