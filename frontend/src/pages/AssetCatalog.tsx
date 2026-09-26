import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { CheckCircleOutlined, DownloadOutlined, PlusOutlined, ToolOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useAssetStore } from '../stores/assetStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { ReshootItem } from '../types/reshoot';
import { calcGsd, distanceMeters } from '../utils/geoCalc';
import { loadFlightLine } from '../utils/db';

const RESHOOT_REASON_COLOR: Record<string, string> = {
  模糊: 'gold',
  过曝: 'red',
};

/** /missions/:id/assets 成果影像编目：格子列出片号/缩略图/GSD/质量，多选标记、定位到图、补拍清单与验收 */
export default function AssetCatalog() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const acceptMission = useMissionStore((s) => s.accept);
  const waypoints = useWaypointStore((s) => s.items);
  const assets = useAssetStore((s) => s.items);
  const thumbs = useAssetStore((s) => s.thumbs);
  const reshoots = useAssetStore((s) => s.reshoots);
  const addMany = useAssetStore((s) => s.addMany);
  const markMany = useAssetStore((s) => s.markMany);
  const removeMany = useAssetStore((s) => s.removeMany);

  const mission = missions.find((m) => m.id === id);
  const missionAssets = useMemo(
    () => assets.filter((a) => a.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [assets, id],
  );
  const missionWaypoints = useMemo(
    () => waypoints.filter((w) => w.missionId === id).sort((a, b) => a.seq - b.seq),
    [waypoints, id],
  );
  const missionReshoots = useMemo(
    () =>
      reshoots
        .filter((r) => r.missionId === id)
        .sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [reshoots, id],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [lineSaved, setLineSaved] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    void loadFlightLine(id).then((line) => setLineSaved(!!line));
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = missionAssets.filter((a) => {
    if (qualityFilter !== 'all' && a.quality !== qualityFilter) return false;
    if (keyword && !a.imageNo.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  });

  const stats = IMAGE_QUALITIES.map((quality) => ({
    quality,
    count: missionAssets.filter((a) => a.quality === quality).length,
  }));

  const archived = mission?.status === '已归档';
  const accepted = mission?.status === '已验收' || archived;
  /** 验收通过后质量结论封存，影像质量与补拍清单不可再改 */
  const qualityLocked = accepted;
  const qualifiedCount = missionAssets.filter((a) => a.quality === '合格').length;

  /** 批量编目：按航点位置与当前航线 GSD 生成影像条目 */
  const catalogFromWaypoints = async () => {
    if (!mission) return;
    if (missionWaypoints.length === 0) {
      setError('该任务暂无航点，请先到「航点明细」录入或点击网格新增');
      return;
    }
    const gsd = calcGsd(mission.pixelSize, missionWaypoints[0].altitude, mission.focalLength);
    const startNo = missionAssets.length + 1;
    const drafts: ImageAssetDraft[] = missionWaypoints.map((w, index) => ({
      missionId: mission.id,
      imageNo: `IMG_${String(2000 + startNo + index)}`,
      lng: w.lng,
      lat: w.lat,
      altitude: w.altitude,
      gsd: calcGsd(mission.pixelSize, w.altitude, mission.focalLength) || gsd,
      overlap: 75,
      tiltAngle: Math.abs(w.gimbalPitch + 90),
      shotAt: Date.now() + index * 1000,
      quality: '合格' as ImageQuality,
      folder: `/${mission.missionNo}/100MEDIA`,
    }));
    await addMany(drafts);
    setError('');
    setToast(`已按 ${drafts.length} 个航点批量编目影像条目（GSD ${gsd} cm/px）`);
  };

  const locate = (asset: ImageAsset) => {
    if (missionWaypoints.length === 0) return;
    let best = missionWaypoints[0];
    let bestDist = Number.POSITIVE_INFINITY;
    missionWaypoints.forEach((w) => {
      const d = distanceMeters([asset.lng, asset.lat], [w.lng, w.lat]);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    });
    setLocateSeq(best.seq);
    setToast(`已定位到航点 #${best.seq}（距离 ${bestDist.toFixed(1)} m）`);
  };

  const exportList = () => {
    const header = '片号,经度,纬度,航高m,GSDcm/px,重叠%,倾角°,质量,归档目录';
    const lines = missionAssets.map((a) =>
      [a.imageNo, a.lng, a.lat, a.altitude, a.gsd, a.overlap, a.tiltAngle, a.quality, a.folder].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `成果影像清单_${mission?.missionNo ?? 'mission'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条影像清单`);
  };

  /** 验收：须已保存航线参数，且全部影像合格（补拍清单清空） */
  const accept = async () => {
    if (!mission) return;
    if (!lineSaved) {
      setError('请先在「航线规划」页保存航线参数，再提交验收');
      return;
    }
    if (missionAssets.length === 0) {
      setError('该任务暂无成果影像，无法验收');
      return;
    }
    if (missionReshoots.length > 0) {
      setError(`仍有 ${missionReshoots.length} 张影像待补拍（${missionReshoots.map((r) => r.imageNo).join('、')}），全部合格后才能通过验收`);
      return;
    }
    await acceptMission(mission.id, {
      acceptedAt: Date.now(),
      totalImages: missionAssets.length,
      qualifiedImages: qualifiedCount,
    });
    setError('');
    setToast(`验收通过：影像 ${missionAssets.length} 张全部合格，可到任务台账归档`);
  };

  const reshootColumns: NonNullable<TableProps<ReshootItem>['columns']> = [
    { title: '片号', dataIndex: 'imageNo', width: 140 },
    {
      title: '质量原因',
      dataIndex: 'reason',
      width: 110,
      render: (v: string) => <Tag color={RESHOOT_REASON_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '进入清单时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: number) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  if (!mission) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该任务" />
        <Link to="/missions">返回任务台账</Link>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          成果影像编目 · {mission.missionNo}
        </Typography.Title>
        <Tag color="cyan">{mission.purpose}</Tag>
        <Tag>条目 {missionAssets.length} 张</Tag>
        {missionReshoots.length > 0 ? <Tag color="red">待补拍 {missionReshoots.length} 张</Tag> : null}
        {accepted ? <Tag color="geekblue">已验收</Tag> : null}
        {archived ? <Tag color="purple">已归档 · 只读</Tag> : null}
        <div style={{ flex: 1 }} />
        <Button type="link">
          <Link to={`/missions/${mission.id}/route`}>航线规划</Link>
        </Button>
        <Button type="link">
          <Link to={`/missions/${mission.id}/waypoints`}>航点明细</Link>
        </Button>
        <Button type="link">
          <Link to="/missions">返回台账</Link>
        </Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}
      {archived ? (
        <Alert type="info" showIcon message="任务已归档：航点、航线、影像质量与补拍清单均已封存，仅供查看。" />
      ) : null}

      <Row gutter={12}>
        {stats.map((s) => (
          <Col span={5} key={s.quality}>
            <Card size="small">
              <Statistic title={`${s.quality}影像`} value={s.count} suffix="张" />
            </Card>
          </Col>
        ))}
        <Col span={5}>
          <Card size="small">
            <Statistic title="待补拍" value={missionReshoots.length} suffix="张" />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="航点数量" value={missionWaypoints.length} suffix="个" />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap size={10}>
          <Input
            allowClear
            style={{ width: 200 }}
            placeholder="按片号筛选"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            style={{ width: 140 }}
            value={qualityFilter}
            onChange={(v) => setQualityFilter(v as ImageQuality | 'all')}
            options={[{ value: 'all', label: '全部质量' }, ...IMAGE_QUALITIES.map((q) => ({ value: q, label: q }))]}
          />
          <Button type="primary" icon={<PlusOutlined />} disabled={qualityLocked} onClick={catalogFromWaypoints}>
            按航点批量编目
          </Button>
          <Button
            disabled={qualityLocked || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '合格');
              setToast(`已把 ${selected.length} 张标记为「合格」`);
            }}
          >
            标记合格
          </Button>
          <Button
            disabled={qualityLocked || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '模糊');
              setToast(`已把 ${selected.length} 张标记为「模糊」，片号已进入补拍清单`);
            }}
          >
            标记模糊
          </Button>
          <Button
            disabled={qualityLocked || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '过曝');
              setToast(`已把 ${selected.length} 张标记为「过曝」，片号已进入补拍清单`);
            }}
          >
            标记过曝
          </Button>
          <Button
            danger
            disabled={qualityLocked || selected.length === 0}
            onClick={async () => {
              await removeMany(selected);
              setToast(`已删除 ${selected.length} 条影像条目`);
              setSelected([]);
            }}
          >
            删除选中
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportList} disabled={missionAssets.length === 0}>
            导出成果清单
          </Button>
        </Space>
      </Card>

      <Row gutter={14}>
        <Col span={16}>
          <Card size="small" title={`影像格子（筛选后 ${filtered.length} 张）`}>
            <AssetGrid
              assets={filtered}
              thumbs={thumbs}
              selectedIds={selected}
              onToggle={(assetId) =>
                setSelected((prev) => (prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId]))
              }
              onToggleAll={(ids) => setSelected(ids)}
              onLocate={locate}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="定位到图">
            <AmapRouteView
              mission={mission}
              waypoints={missionWaypoints}
              altitude={missionWaypoints[0]?.altitude ?? 120}
              height={340}
              highlightSeq={locateSeq}
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={
          <Space size={8}>
            <ToolOutlined />
            <span>补拍清单（模糊 / 过曝影像按片号自动进入，改回合格即移出）</span>
          </Space>
        }
      >
        <Table<ReshootItem>
          rowKey="id"
          size="small"
          columns={reshootColumns}
          dataSource={missionReshoots}
          pagination={false}
          locale={{ emptyText: '暂无待补拍影像' }}
        />
      </Card>

      <Card
        size="small"
        title={
          <Space size={8}>
            <CheckCircleOutlined />
            <span>成果验收</span>
          </Space>
        }
      >
        {mission.acceptance ? (
          <Alert
            type="success"
            showIcon
            message={`已于 ${new Date(mission.acceptance.acceptedAt).toLocaleString('zh-CN')} 通过验收：影像总数 ${mission.acceptance.totalImages} 张，合格 ${mission.acceptance.qualifiedImages} 张`}
            description={archived ? '任务已归档，验收记录随档案封存。' : '任务已验收，可在任务台账执行归档；归档后全部数据只读。'}
          />
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space wrap size={16}>
              <Typography.Text type={lineSaved ? 'success' : 'secondary'}>
                {lineSaved ? '✓' : '○'} 航线参数已保存
              </Typography.Text>
              <Typography.Text type={missionAssets.length > 0 ? 'success' : 'secondary'}>
                {missionAssets.length > 0 ? '✓' : '○'} 成果影像 {missionAssets.length} 张
              </Typography.Text>
              <Typography.Text type={missionReshoots.length === 0 && missionAssets.length > 0 ? 'success' : 'secondary'}>
                {missionReshoots.length === 0 && missionAssets.length > 0 ? '✓' : '○'} 全部影像合格（待补拍 {missionReshoots.length} 张）
              </Typography.Text>
            </Space>
            <Space>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={accept}>
                通过验收
              </Button>
              <Typography.Text type="secondary">验收通过后质量结论封存，任务进入「已验收」，可在台账归档。</Typography.Text>
            </Space>
          </Space>
        )}
      </Card>
    </Space>
  );
}
