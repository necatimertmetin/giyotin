import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StraightenIcon from '@mui/icons-material/Straighten';
import { useState, type ReactElement } from 'react';
import type { StockItemDto } from '../../shared/api';
import { api } from '../api';
import { ErrorNote, PageHeader } from '../components/common';
import { PapersDialog } from '../components/PapersDialog';
import { StockDialog } from '../components/StockDialog';
import { StockTable } from '../components/StockTable';
import { useLoad, useToast } from '../hooks';

export function InventoryPage(): ReactElement {
  const stock = useLoad(api.stock.list);
  const papers = useLoad(api.papers.list);
  const toast = useToast();
  const [editing, setEditing] = useState<StockItemDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [papersOpen, setPapersOpen] = useState(false);
  const [deleting, setDeleting] = useState<StockItemDto | null>(null);

  const sheets = (stock.data ?? []).filter((s) => s.kind === 'sheet');

  return (
    <>
      <PageHeader
        title="Kağıt Envanteri"
        subtitle="Tam boy tabakalarınızı kaydedin. Hazır formatları kullanabilir veya stoğunuzdaki gerçek ölçüleri serbestçe girebilirsiniz. Artık parçalar ayrı sayfada yönetilir."
        actions={
          <>
            <Button startIcon={<StraightenIcon />} variant="outlined" color="secondary" onClick={() => setPapersOpen(true)}>Formatlar</Button>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="add-stock">Stok ekle</Button>
          </>
        }
      />
      <ErrorNote message={stock.error} />
      {stock.loading && !stock.data && <LinearProgress />}
      {stock.data && <StockTable items={sheets} kind="sheet" onEdit={(s) => { setEditing(s); setDialogOpen(true); }} onDelete={setDeleting} />}

      <StockDialog open={dialogOpen} kind="sheet" initial={editing} customPapers={papers.data ?? []} onClose={() => setDialogOpen(false)} onSaved={stock.reload} />
      <PapersDialog open={papersOpen} papers={papers.data ?? []} onClose={() => setPapersOpen(false)} onChanged={papers.reload} />
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Stok kaydı silinsin mi?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{deleting?.name}” kaydı envanterden kaldırılacak. Daha önce onaylanmış işlerin kesim planları ve geçmişi etkilenmez.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!deleting) return;
              try {
                await api.stock.remove(deleting.id);
                toast('Stok kaydı silindi.');
                stock.reload();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Silinemedi.', 'error');
              }
              setDeleting(null);
            }}
          >
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
