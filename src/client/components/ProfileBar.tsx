import { Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useState, type ReactElement } from 'react';
import { DEFAULT_SETTINGS, edgeMarginsOf, type CuttingSettings } from '../../engine';
import type { SettingsProfileDto } from '../../shared/api';
import { api } from '../api';
import { useToast } from '../hooks';

interface Props {
  settings: CuttingSettings;
  profiles: SettingsProfileDto[];
  onApply: (s: CuttingSettings) => void;
  onChanged: () => void;
}

/** Only the settings the user can see take part in "is this the saved profile?". */
const KEYS: Array<keyof CuttingSettings> = ['kerf', 'edgeMargin', 'minOffcutWidth', 'minOffcutHeight'];
const same = (a: CuttingSettings, b: CuttingSettings): boolean =>
  KEYS.every((k) => a[k] === b[k]) && JSON.stringify(edgeMarginsOf(a)) === JSON.stringify(edgeMarginsOf(b));

/** Saved cutting-settings profiles: one click applies, the current values can be saved under a name. */
export function ProfileBar({ settings, profiles, onApply, onChanged }: Props): ReactElement {
  const toast = useToast();
  const [name, setName] = useState('');

  const all = [{ id: 0, name: 'Standart', settings: DEFAULT_SETTINGS }, ...profiles];
  const active = all.find((p) => same(p.settings, settings));

  const save = async (): Promise<void> => {
    const target = name.trim() || (active && active.id !== 0 ? active.name : '');
    if (!target) {
      toast('Profil için bir ad yazın.', 'warning');
      return;
    }
    try {
      await api.profiles.save(target, settings);
      toast(`“${target}” profili kaydedildi.`);
      setName('');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Kaydedilemedi.', 'error');
    }
  };

  return (
    <Paper sx={{ p: 2, borderTop: 3, borderTopColor: 'primary.main' }} data-testid="profile-bar">
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography sx={{ fontWeight: 700 }}>Ayar profilleri</Typography>
        <Typography variant="caption" sx={{ color: active ? 'success.main' : 'warning.main', fontWeight: 600 }} data-testid="profile-state">
          {active ? `Kayıtlı profil: ${active.name}` : 'Profilden farklı · kaydedilmedi'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ my: 1.5 }}>
        {all.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            clickable
            color={active?.id === p.id ? 'primary' : 'default'}
            variant={active?.id === p.id ? 'filled' : 'outlined'}
            icon={active?.id === p.id ? <CheckIcon /> : undefined}
            onClick={() => onApply({ ...settings, edgeMargins: undefined, ...p.settings })}
            onDelete={
              p.id === 0
                ? undefined
                : async () => {
                    await api.profiles.remove(p.id);
                    toast(`“${p.name}” profili silindi.`);
                    onChanged();
                  }
            }
            data-testid={`profile-chip-${p.name}`}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          placeholder="Profil adı, örn. Kalın kâğıt"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          inputProps={{ 'aria-label': 'Profil adı', 'data-testid': 'profile-name' }}
        />
        <Button variant="contained" onClick={save} data-testid="profile-save">Kaydet</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Aynı ada kaydederseniz profil güncellenir. Kayıtlı profiller sonraki işlerde de tek tıkla seçilebilir.
      </Typography>
    </Paper>
  );
}
