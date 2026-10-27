import { Box, Stack, Typography } from '@mui/material';
import type { ReactElement } from 'react';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtDims, fmtNum } from '../format';
import { describeCut } from './cutText';
import type { PieceInfo, Selection } from './viewerTypes';

interface Props {
  selection: Selection | null;
  pieces: Map<string, PieceInfo>;
  kerf: number;
}

export function SelectionInfo({ selection, pieces, kerf }: Props): ReactElement {
  if (!selection) {
    return (
      <Typography variant="body2" color="text.secondary">
        Ayrıntı görmek için çizimde bir parçaya, artığa veya kesim çizgisine tıklayın.
      </Typography>
    );
  }
  if (selection.kind === 'piece') {
    const n = selection.node;
    const info = pieces.get(n.pieceId);
    return (
      <Stack spacing={0.75} data-testid="selection-info">
        <Typography variant="subtitle2">Bitmiş parça</Typography>
        <Typography variant="h6">
          <Box component="span" sx={{ fontFamily: FONT_MONO, mr: 1 }}>{info?.code}</Box>
          {info?.name ?? n.pieceId}
        </Typography>
        <Typography variant="body2">Kesilen ölçü: <b>{fmtDims(n.w, n.h)}</b></Typography>
        {info && <Typography variant="body2">Sipariş ölçüsü: {fmtDims(info.width, info.height)}{n.rotated ? ' — bu kalıpta 90° döndürülerek kesilir' : ''}</Typography>}
        <Typography variant="body2" color="text.secondary">Konum (sol-üst köşe): {fmtNum(n.x)} mm, {fmtNum(n.y)} mm</Typography>
        <Typography variant="body2" color="text.secondary">Alan: {fmtArea(n.w * n.h)}</Typography>
      </Stack>
    );
  }
  if (selection.kind === 'cut') {
    const d = describeCut(selection.node, kerf);
    return (
      <Stack spacing={0.75} data-testid="selection-info">
        <Typography variant="subtitle2">Kesim</Typography>
        <Typography variant="h6">#{selection.node.sequence} — {d.title}</Typography>
        <Typography variant="body2">{d.instruction}</Typography>
        <Typography variant="body2">Bıçak payı (kerf): <b>{fmtNum(selection.node.kerf)} mm</b></Typography>
        {d.results.map((r) => (
          <Typography key={r} variant="body2" color="text.secondary">→ {r}</Typography>
        ))}
        <Typography variant="caption" color="text.secondary">Kesim sırası kalıbın kesim ağacından (derinlik öncelikli) türetilir.</Typography>
      </Stack>
    );
  }
  const n = selection.node;
  return (
    <Stack spacing={0.75} data-testid="selection-info">
      <Typography variant="subtitle2">{n.type === 'offcut' ? 'Yeniden kullanılabilir artık' : 'Kullanılamaz fire'}</Typography>
      <Typography variant="h6">{fmtDims(n.w, n.h)}</Typography>
      <Typography variant="body2" color="text.secondary">Alan: {fmtArea(n.w * n.h)}</Typography>
      <Typography variant="body2" color="text.secondary">
        {n.type === 'offcut'
          ? 'Kesim ağacının gerçek bir dikdörtgen yaprağıdır; iş onaylandıktan sonra envantere eklenebilir.'
          : 'Minimum artık ölçüsünün altında olduğu için envantere eklenmez.'}
      </Typography>
    </Stack>
  );
}
