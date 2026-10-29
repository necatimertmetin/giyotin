import { type ReactElement } from 'react';
import { PageHeader } from '../components/common';
import { MachineSettings } from '../components/MachineForm';

export function SettingsPage(): ReactElement {
  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Makine bilgileri bir kez girilir ve tüm kesim işlerinde kullanılır." />
      <MachineSettings />
    </>
  );
}
