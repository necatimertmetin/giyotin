import { Box, Typography } from '@mui/material';
import { useState, type ReactElement } from 'react';
import type { TreeNode } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtNum } from '../format';
import type { PieceInfo } from './viewerTypes';

interface Props {
  tree: TreeNode;
  pieces: Map<string, PieceInfo>;
}

function Node({ node, pieces, depth }: { node: TreeNode; pieces: Map<string, PieceInfo>; depth: number }): ReactElement {
  const [open, setOpen] = useState(depth < 2);
  const sx = { fontFamily: FONT_MONO, fontSize: '0.78rem', py: 0.2 } as const;
  if (node.type === 'piece') {
    const info = pieces.get(node.pieceId);
    return (
      <Box sx={sx}>
        ▣ <b>{info?.code}</b> {info?.name} · {fmtNum(node.w)}×{fmtNum(node.h)}{node.rotated ? ' ↻' : ''}
      </Box>
    );
  }
  if (node.type === 'offcut' || node.type === 'waste') {
    return (
      <Box sx={{ ...sx, color: node.type === 'offcut' ? 'success.main' : 'error.main' }}>
        {node.type === 'offcut' ? '◩ artık' : '▨ fire'} · {fmtNum(node.w)}×{fmtNum(node.h)}
      </Box>
    );
  }
  return (
    <Box>
      <Box sx={{ ...sx, cursor: 'pointer', fontWeight: 600 }} onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o); }}>
        {open ? '▾' : '▸'} #{node.sequence} {node.direction === 'vertical' ? 'dikey' : 'yatay'} @ {fmtNum(node.position)} · bölge {fmtNum(node.w)}×{fmtNum(node.h)}
      </Box>
      {open && (
        <Box sx={{ pl: 2, borderLeft: '1px solid', borderColor: 'divider', ml: 0.75 }}>
          <Node node={node.first} pieces={pieces} depth={depth + 1} />
          {node.second && <Node node={node.second} pieces={pieces} depth={depth + 1} />}
        </Box>
      )}
    </Box>
  );
}

export function CutTree({ tree, pieces }: Props): ReactElement {
  return (
    <Box data-testid="cut-tree" sx={{ maxHeight: 420, overflow: 'auto' }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Her iç düğüm tüm bölgeyi baştan sona ayıran bir giyotin kesimdir; yapraklar bitmiş parça, artık veya firedir.
      </Typography>
      <Node node={tree} pieces={pieces} depth={0} />
    </Box>
  );
}
