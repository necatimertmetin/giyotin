import { type ReactElement } from 'react';
import { PageHeader } from '../components/common';
import { BackupSettings } from '../components/BackupSettings';
import { MachineSettings } from '../components/MachineForm';

export function SettingsPage(): ReactElement {
  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Makine bilgileri ve verilerin yedeği." />
      <MachineSettings />
      <BackupSettings />
    </>
  );
}
