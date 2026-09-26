import type { ImageQuality } from './imageasset';

/** 触发补拍的质量原因（仅模糊、过曝入池） */
export type ReshootReason = Exclude<ImageQuality, '合格'>;

export const RESHOOT_REASONS: ReshootReason[] = ['模糊', '过曝'];

/** 补拍清单条目：按片号登记，保留质量原因 */
export interface ReshootItem {
  id: string;
  missionId: string;
  /** 影像片号（同任务同片号只保留一条） */
  imageNo: string;
  /** 入池时的质量原因 */
  reason: ReshootReason;
  /** 对应的成果影像条目 id；原片被删除时可能悬空 */
  assetId?: string;
  /** 入池时间 ms */
  createdAt: number;
  /** 是否已销项（外业补拍完成或原片复验合格） */
  resolved: boolean;
  /** 销项时间 ms */
  resolvedAt?: number;
}

export type ReshootDraft = Omit<ReshootItem, 'id' | 'createdAt' | 'resolved' | 'resolvedAt'>;
