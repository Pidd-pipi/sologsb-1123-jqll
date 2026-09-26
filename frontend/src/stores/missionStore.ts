import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { CameraPreset, Mission, MissionDraft, MissionStatus } from '../types/mission';

interface MissionState {
  items: Mission[];
  presets: CameraPreset[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: MissionDraft) => Promise<Mission>;
  update: (id: string, patch: Partial<Mission>) => Promise<void>;
  setStatus: (id: string, status: MissionStatus) => Promise<void>;
  /** 验收通过：记录验收时间与当时的影像总数、合格数，任务置为已验收 */
  accept: (id: string, totalCount: number, qualifiedCount: number) => Promise<void>;
  /** 归档：仅已验收任务可归档，记录归档时间，之后航点/航线/影像/补拍均只读 */
  archive: (id: string) => Promise<void>;
  applyPreset: (missionId: string, presetId: string) => Promise<void>;
  addPreset: (draft: Omit<CameraPreset, 'id'>) => Promise<CameraPreset>;
  removePreset: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  items: [],
  presets: [],
  loaded: false,
  async load() {
    const rows = await db.missions.orderBy('createdAt').reverse().toArray();
    const presets = await db.presets.toArray();
    set({ items: rows, presets, loaded: true });
  },
  async add(draft) {
    const record: Mission = { ...draft, id: newId('mission'), createdAt: Date.now() };
    await db.missions.put(record);
    set({ items: [record, ...get().items] });
    return record;
  },
  async update(id, patch) {
    await db.missions.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async setStatus(id, status) {
    await get().update(id, { status });
  },
  async accept(id, totalCount, qualifiedCount) {
    const acceptedAt = Date.now();
    await get().update(id, {
      status: '已验收',
      acceptedAt,
      acceptedTotalCount: totalCount,
      acceptedQualifiedCount: qualifiedCount,
    });
  },
  async archive(id) {
    const mission = get().items.find((m) => m.id === id);
    if (!mission || mission.status !== '已验收') return;
    await get().update(id, { status: '已归档', archivedAt: Date.now() });
  },
  async applyPreset(missionId, presetId) {
    const preset = get().presets.find((p) => p.id === presetId);
    if (!preset) return;
    await get().update(missionId, {
      cameraModel: preset.cameraModel,
      sensorWidth: preset.sensorWidth,
      sensorHeight: preset.sensorHeight,
      focalLength: preset.focalLength,
      pixelSize: preset.pixelSize,
    });
  },
  async addPreset(draft) {
    const record: CameraPreset = { ...draft, id: newId('preset') };
    await db.presets.put(record);
    set({ presets: [...get().presets, record] });
    return record;
  },
  async removePreset(id) {
    await db.presets.delete(id);
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },
  async remove(id) {
    await db.missions.delete(id);
    // 级联清理该任务的补拍清单，避免遗留悬空条目
    await db.reshoots.where('missionId').equals(id).delete();
    set({ items: get().items.filter((it) => it.id !== id) });
  },
}));
