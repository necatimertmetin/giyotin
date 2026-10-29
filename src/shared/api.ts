import type { CuttingSettings, OptimizationInput, OptimizationResult, Plan, StockGrain, PieceGrain } from '../engine/types';

export type StockStatus = 'active' | 'excluded';

export interface StockItemDto {
  id: number;
  kind: 'sheet' | 'offcut';
  name: string;
  formatName: string | null;
  width: number;
  height: number;
  quantity: number;
  unitCost: number | null;
  gsm: number | null;
  color: string | null;
  finish: string | null;
  notes: string | null;
  allowRotation: boolean;
  grain: StockGrain;
  materialKey: string;
  status: StockStatus;
  sourceJobId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type StockInput = Omit<StockItemDto, 'id' | 'materialKey' | 'version' | 'createdAt' | 'updatedAt' | 'sourceJobId'>;

export interface CustomPaperDto {
  id: number;
  name: string;
  width: number;
  height: number;
}

export interface OrderLineDto {
  id?: number;
  name: string;
  width: number;
  height: number;
  quantity: number;
  notes: string | null;
  allowRotation: boolean;
  /** Material key of the stock this product must be cut from; null = any material. */
  materialKey: string | null;
  grain: PieceGrain;
  minWidth: number | null;
  minHeight: number | null;
  /** Preview image of the product, imported from its artwork file (see /api/artworks); null = none. */
  artworkId: string | null;
}

export interface ArtworkDto {
  id: string;
  /** Image data URL (PNG/WebP thumbnail). */
  data: string;
}

export interface OrderDto {
  id: number;
  name: string;
  notes: string | null;
  status: 'draft' | 'completed';
  createdAt: string;
  updatedAt: string;
  lines: OrderLineDto[];
}

export interface OrderInput {
  name: string;
  notes: string | null;
  lines: OrderLineDto[];
}

export interface OptimizeRequest {
  orderId: number | null;
  lines: OrderLineDto[];
  settings: CuttingSettings;
}

export interface RunDto {
  id: string;
  createdAt: string;
  orderId: number | null;
  orderName: string;
  settings: CuttingSettings;
  input: OptimizationInput;
  result: OptimizationResult;
  confirmedJobId: number | null;
}

export interface ConfirmRequest {
  planId: string;
  /** Offcut ids (`sheetIndex:leafIndex`) to add to the inventory right away. */
  approvedOffcuts: string[];
}

export interface JobOffcutDto {
  id: number;
  sheetIndex: number;
  width: number;
  height: number;
  quantity: number;
  status: 'pending' | 'added' | 'discarded';
  stockItemId: number | null;
  notes: string | null;
}

export interface JobDto {
  id: number;
  orderId: number | null;
  orderName: string;
  createdAt: string;
  settings: CuttingSettings;
  input: OptimizationInput;
  plan: Plan;
  offcuts: JobOffcutDto[];
}

export interface JobSummaryDto {
  id: number;
  orderName: string;
  createdAt: string;
  sheetCount: number;
  utilization: number;
  pieceArea: number;
  stockArea: number;
  wasteArea: number;
  offcutArea: number;
  cuts: number;
  cost: number | null;
  fulfilled: boolean;
}

export interface SettingsProfileDto {
  id: number;
  name: string;
  settings: CuttingSettings;
  updatedAt: string;
}

export interface ApiError {
  message: string;
}

export const normalizeKeyPart = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).trim().toLocaleLowerCase('tr-TR');

/** Stock items with the same key are the same material (never mixed otherwise). */
export const materialKeyOf = (s: { name: string; gsm: number | null; color: string | null; finish: string | null }): string =>
  [normalizeKeyPart(s.name), normalizeKeyPart(s.gsm), normalizeKeyPart(s.color), normalizeKeyPart(s.finish)].join('|');

export const materialLabelOf = (s: { name: string; gsm: number | null; color: string | null; finish: string | null }): string =>
  [s.name, s.gsm ? `${s.gsm} gr` : null, s.color, s.finish].filter(Boolean).join(' · ');
