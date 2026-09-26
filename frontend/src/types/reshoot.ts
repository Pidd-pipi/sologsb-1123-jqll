import type { ImageQuality } from './imageasset';

/** 补拍清单条目：模糊 / 过曝影像按片号进入清单，并保留质量原因 */
export interface ReshootItem {
  id: string;
  missionId: string;
  /** 对应成果影像条目 id */
  assetId: string;
  /** 影像片号 */
  imageNo: string;
  /** 质量原因（模糊 / 过曝） */
  reason: ImageQuality;
  /** 进入清单时间 */
  createdAt: number;
}
