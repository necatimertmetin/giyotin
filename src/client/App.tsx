import { AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import RecyclingIcon from '@mui/icons-material/RecyclingOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { useState, type ReactElement } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage, JobPage } from './pages/HistoryPage';
import { InventoryPage } from './pages/InventoryPage';
import { NewJobPage } from './pages/NewJobPage';
import { OffcutsPage } from './pages/OffcutsPage';
import { PlanPage } from './pages/PlanPage';
import { SettingsPage } from './pages/SettingsPage';
import { MachineSetupDialog } from './components/MachineForm';
import { STATIC_MODE } from './api';
import { LogoMark } from './components/Logo';
import { GRAPHITE } from './theme';

const NAV = [
  { to: '/', label: 'Panel', icon: <DashboardIcon />, match: (p: string) => p === '/' },
  { to: '/envanter', label: 'Kağıt Envanteri', icon: <InventoryIcon />, match: (p: string) => p.startsWith('/envanter') },
  { to: '/yeni-is', label: 'Yeni Kesim İşi', icon: <ContentCutIcon />, match: (p: string) => p.startsWith('/yeni-is') || p.startsWith('/plan') },
  { to: '/artiklar', label: 'Artık Parçalar', icon: <RecyclingIcon />, match: (p: string) => p.startsWith('/artiklar') },
  { to: '/gecmis', label: 'Kesim Geçmişi', icon: <HistoryIcon />, match: (p: string) => p.startsWith('/gecmis') },
  { to: '/ayarlar', label: 'Ayarlar', icon: <SettingsIcon />, match: (p: string) => p.startsWith('/ayarlar') },
];

const DRAWER = 232;

function Brand(): ReactElement {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, height: 56 }}>
      <LogoMark size={32} />
      <Box>
        <Typography sx={{ color: '#fff', fontWeight: 700, lineHeight: 1.1, letterSpacing: '0.02em' }}>GİYOTİN</Typography>
        <Typography sx={{ color: '#9aa5b1', fontSize: '0.68rem', letterSpacing: '0.12em' }}>KESİM PLANLAYICI</Typography>
      </Box>
    </Box>
  );
}

export function App(): ReactElement {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  const nav = (
    <Box sx={{ bgcolor: GRAPHITE, height: '100%', color: '#d7dde4' }}>
      <Brand />
      <List sx={{ px: 1 }}>
        {NAV.map((n) => {
          const active = n.match(pathname);
          return (
            <ListItemButton
              key={n.to}
              component={Link}
              to={n.to}
              onClick={() => setOpen(false)}
              selected={active}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                color: active ? '#fff' : '#b6c0ca',
                borderLeft: '3px solid',
                borderColor: active ? 'primary.light' : 'transparent',
                '&.Mui-selected': { bgcolor: 'rgba(255,255,255,0.08)' },
                '&.Mui-selected:hover, &:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
              }}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: 38 }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} primaryTypographyProps={{ fontSize: '0.92rem', fontWeight: active ? 650 : 500 }} />
            </ListItemButton>
          );
        })}
      </List>
      {STATIC_MODE && (
        <Typography sx={{ color: '#9aa5b1', fontSize: '0.74rem', px: 2.5, pt: 1, lineHeight: 1.5 }} data-testid="local-note">
          Tarayıcı sürümü: veriler yalnızca bu tarayıcıda saklanır. Başka cihazda görünmez.
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {desktop ? (
        <Drawer variant="permanent" sx={{ width: DRAWER, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER, border: 0, boxSizing: 'border-box' } }} open>
          {nav}
        </Drawer>
      ) : (
        <>
          <AppBar position="fixed" sx={{ bgcolor: GRAPHITE }} elevation={0}>
            <Toolbar variant="dense">
              <IconButton color="inherit" edge="start" aria-label="Menüyü aç" onClick={() => setOpen(true)} sx={{ mr: 1 }}>
                <MenuIcon />
              </IconButton>
              <Typography sx={{ fontWeight: 700 }}>Giyotin Kesim Planlayıcı</Typography>
            </Toolbar>
          </AppBar>
          <Drawer open={open} onClose={() => setOpen(false)} sx={{ '& .MuiDrawer-paper': { width: DRAWER, border: 0 } }}>
            {nav}
          </Drawer>
        </>
      )}
      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 }, pt: { xs: 9, md: 3 }, maxWidth: 1600 }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/envanter" element={<InventoryPage />} />
          <Route path="/yeni-is" element={<NewJobPage />} />
          <Route path="/plan/:runId" element={<PlanPage />} />
          <Route path="/artiklar" element={<OffcutsPage />} />
          <Route path="/gecmis" element={<HistoryPage />} />
          <Route path="/gecmis/:jobId" element={<JobPage />} />
          <Route path="/ayarlar" element={<SettingsPage />} />
          <Route path="*" element={<Typography>Sayfa bulunamadı.</Typography>} />
        </Routes>
      </Box>
      <MachineSetupDialog />
    </Box>
  );
}
