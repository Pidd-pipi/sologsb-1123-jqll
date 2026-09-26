import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { ImageAsset } from '../types/imageasset';
import type { ReshootItem } from '../types/reshoot';

interface ReshootState {
  items: ReshootItem[];
  loaded: boolean;
  load: () => Promise<void>;
  /** 按任务内最新的影像质量结果对齐补拍清单：不合格入池、复验合格销项 */
  reconcileMission: (missionId: string) => Promise<void>;
  /** 手动登记补拍（外业反馈等场景） */
  add: (draft: Omit<ReshootItem, 'id' | 'createdAt' | 'resolved' | 'resolvedAt'>) => Promise<void>;
  /** 标记补拍完成（销项） */
  resolve: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  byMission: (missionId: string) => ReshootItem[];
}

const byImageNo = (a: ReshootItem, b: ReshootItem) =>
  a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true });

/** 由影像质量结果推导某任务补拍清单应有状态，供 reconcile 比对 */
export function expectedReshoots(assets: ImageAsset[]): ReshootItem[] {
  const now = Date.now();
  return assets
    .filter((a) => a.quality === '模糊' || a.quality === '过曝')
    .map((a) => ({
      id: '',
      missionId: a.missionId,
      imageNo: a.imageNo,
      reason: a.quality as ReshootItem['reason'],
      assetId: a.id,
      createdAt: now,
      resolved: false,
    }));
}

export const useReshootStore = create<ReshootState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.reshoots.toArray();
    rows.sort(byImageNo);
    set({ items: rows, loaded: true });
  },
  async reconcileMission(missionId) {
    const assets = await db.assets.where('missionId').equals(missionId).toArray();
    const expected = expectedReshoots(assets);
    // 以数据库中的补拍记录为准，避免内存列表未加载时重复入池
    const existing = await db.reshoots.where('missionId').equals(missionId).toArray();
    const expectedMap = new Map(expected.map((e) => [e.imageNo, e]));

    const toPut: ReshootItem[] = [];

    existing.forEach((it) => {
      const exp = expectedMap.get(it.imageNo);
      if (!exp) {
        // 原片已复验合格：自动销项；原片被删除且从未处理：保留待人工处置
        const stillExists = assets.some((a) => a.id === it.assetId || a.imageNo === it.imageNo);
        if (stillExists && !it.resolved) {
          toPut.push({ ...it, resolved: true, resolvedAt: Date.now() });
        }
        return;
      }
      if (it.resolved) {
        // 已销项的片号再次判为不合格：重新入池
        toPut.push({ ...it, reason: exp.reason, assetId: exp.assetId, resolved: false, resolvedAt: undefined });
      } else if (it.reason !== exp.reason || it.assetId !== exp.assetId) {
        toPut.push({ ...it, reason: exp.reason, assetId: exp.assetId });
      }
    });

    const existingNos = new Set(existing.map((it) => it.imageNo));
    expected.forEach((exp) => {
      if (!existingNos.has(exp.imageNo)) {
        toPut.push({ ...exp, id: newId('reshoot'), createdAt: Date.now() });
      }
    });

    if (toPut.length === 0) return;
    await db.reshoots.bulkPut(toPut);
    const rows = await db.reshoots.toArray();
    rows.sort(byImageNo);
    set({ items: rows });
  },
  async add(draft) {
    const record: ReshootItem = {
      ...draft,
      id: newId('reshoot'),
      createdAt: Date.now(),
      resolved: false,
    };
    await db.reshoots.put(record);
    set({ items: [...get().items, record].sort(byImageNo) });
  },
  async resolve(id) {
    const resolvedAt = Date.now();
    await db.reshoots.update(id, { resolved: true, resolvedAt });
    set({ items: get().items.map((it) => (it.id === id ? { ...it, resolved: true, resolvedAt } : it)) });
  },
  async remove(id) {
    await db.reshoots.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  byMission(missionId) {
    return get()
      .items.filter((it) => it.missionId === missionId)
      .sort(byImageNo);
  },
}));
