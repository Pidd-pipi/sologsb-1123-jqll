import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { makeThumbDataUrl, type AssetThumb, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { ReshootItem } from '../types/reshoot';

interface AssetState {
  items: ImageAsset[];
  thumbs: Record<string, string>;
  reshoots: ReshootItem[];
  loaded: boolean;
  load: () => Promise<void>;
  addMany: (drafts: ImageAssetDraft[]) => Promise<ImageAsset[]>;
  update: (id: string, patch: Partial<ImageAsset>) => Promise<void>;
  markMany: (ids: string[], quality: ImageQuality) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  byMission: (missionId: string) => ImageAsset[];
  reshootsByMission: (missionId: string) => ReshootItem[];
  qualityStats: (missionId: string) => { quality: ImageQuality; count: number }[];
}

export const useAssetStore = create<AssetState>((set, get) => ({
  items: [],
  thumbs: {},
  reshoots: [],
  loaded: false,
  async load() {
    const rows = await db.assets.toArray();
    rows.sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true }));
    const thumbRows = await db.thumbs.toArray();
    const thumbs: Record<string, string> = {};
    thumbRows.forEach((t) => {
      thumbs[t.id] = t.dataUrl;
    });
    const reshoots = await db.reshoots.toArray();
    set({ items: rows, thumbs, reshoots, loaded: true });
  },
  async addMany(drafts) {
    const records: ImageAsset[] = drafts.map((d) => ({ ...d, id: newId('asset') }));
    const thumbRecords: AssetThumb[] = records.map((r) => ({
      id: r.id,
      missionId: r.missionId,
      dataUrl: makeThumbDataUrl(r.imageNo, r.quality, r.lng, r.lat),
    }));
    // 缩略图单独建表存放
    await db.assets.bulkPut(records);
    await db.thumbs.bulkPut(thumbRecords);
    const nextThumbs = { ...get().thumbs };
    thumbRecords.forEach((t) => {
      nextThumbs[t.id] = t.dataUrl;
    });
    set({ items: [...get().items, ...records], thumbs: nextThumbs });
    return records;
  },
  async update(id, patch) {
    await db.assets.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async markMany(ids, quality) {
    for (const id of ids) {
      await db.assets.update(id, { quality });
    }
    const items = get().items.map((it) => (ids.includes(it.id) ? { ...it, quality } : it));

    // 同步补拍清单：模糊 / 过曝按片号进入清单并保留质量原因；改回合格则移出
    const stale = get().reshoots.filter((r) => ids.includes(r.assetId));
    if (stale.length > 0) await db.reshoots.bulkDelete(stale.map((r) => r.id));
    let additions: ReshootItem[] = [];
    if (quality !== '合格') {
      additions = ids
        .map((assetId) => {
          const asset = items.find((it) => it.id === assetId);
          if (!asset) return null;
          const prev = stale.find((r) => r.assetId === assetId);
          return {
            id: prev?.id ?? newId('reshoot'),
            missionId: asset.missionId,
            assetId,
            imageNo: asset.imageNo,
            reason: quality,
            createdAt: prev?.createdAt ?? Date.now(),
          } as ReshootItem;
        })
        .filter((r): r is ReshootItem => r !== null);
      await db.reshoots.bulkPut(additions);
    }
    const reshoots = [...get().reshoots.filter((r) => !ids.includes(r.assetId)), ...additions];
    set({ items, reshoots });
  },
  async removeMany(ids) {
    await db.assets.bulkDelete(ids);
    await db.thumbs.bulkDelete(ids);
    const stale = get().reshoots.filter((r) => ids.includes(r.assetId));
    if (stale.length > 0) await db.reshoots.bulkDelete(stale.map((r) => r.id));
    const nextThumbs = { ...get().thumbs };
    ids.forEach((id) => {
      delete nextThumbs[id];
    });
    set({
      items: get().items.filter((it) => !ids.includes(it.id)),
      thumbs: nextThumbs,
      reshoots: get().reshoots.filter((r) => !ids.includes(r.assetId)),
    });
  },
  byMission(missionId) {
    return get().items.filter((it) => it.missionId === missionId);
  },
  reshootsByMission(missionId) {
    return get()
      .reshoots.filter((it) => it.missionId === missionId)
      .sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true }));
  },
  qualityStats(missionId) {
    const list = get().items.filter((it) => it.missionId === missionId);
    return (['合格', '模糊', '过曝'] as ImageQuality[]).map((quality) => ({
      quality,
      count: list.filter((it) => it.quality === quality).length,
    }));
  },
}));
