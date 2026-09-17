export interface RegionInfo {
  code: string;
  name: string;
}

/** Administrative regions of the Kyrgyz Republic used for P2P ad targeting. */
export const REGIONS: RegionInfo[] = [
  { code: 'ALL', name: 'Все регионы' },
  { code: 'BISHKEK', name: 'Бишкек' },
  { code: 'OSH_CITY', name: 'Ош' },
  { code: 'CHUY', name: 'Чуйская область' },
  { code: 'OSH', name: 'Ошская область' },
  { code: 'JALAL_ABAD', name: 'Джалал-Абадская область' },
  { code: 'ISSYK_KUL', name: 'Иссык-Кульская область' },
  { code: 'NARYN', name: 'Нарынская область' },
  { code: 'TALAS', name: 'Таласская область' },
  { code: 'BATKEN', name: 'Баткенская область' },
];

export const REGION_MAP: Record<string, RegionInfo> = Object.fromEntries(REGIONS.map((r) => [r.code, r]));
