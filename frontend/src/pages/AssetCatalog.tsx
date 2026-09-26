import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
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
import { CheckCircleOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useAssetStore } from '../stores/assetStore';
import { useReshootStore } from '../stores/reshootStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { ReshootItem } from '../types/reshoot';
import { calcGsd, distanceMeters } from '../utils/geoCalc';
import { loadFlightLine } from '../utils/db';

const REASON_COLOR: Record<ReshootItem['reason'], string> = {
  模糊: 'gold',
  过曝: 'red',
};

/** /missions/:id/assets 成果影像编目：质量标记、补拍清单与成果验收 */
export default function AssetCatalog() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const waypoints = useWaypointStore((s) => s.items);
  const assets = useAssetStore((s) => s.items);
  const thumbs = useAssetStore((s) => s.thumbs);
  const addMany = useAssetStore((s) => s.addMany);
  const markMany = useAssetStore((s) => s.markMany);
  const removeMany = useAssetStore((s) => s.removeMany);
  const reshoots = useReshootStore((s) => s.items);
  const resolveReshoot = useReshootStore((s) => s.resolve);
  const removeReshoot = useReshootStore((s) => s.remove);
  const acceptMission = useMissionStore((s) => s.accept);

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
    () => reshoots.filter((r) => r.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [reshoots, id],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [reshootFilter, setReshootFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const [lineSaved, setLineSaved] = useState(false);
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const readOnly = mission?.status === '已归档';
  const accepted = mission?.status === '已验收' || mission?.status === '已归档';

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
  const totalCount = missionAssets.length;
  const qualifiedCount = missionAssets.filter((a) => a.quality === '合格').length;
  const pendingReshoots = missionReshoots.filter((r) => !r.resolved);
  const shownReshoots = missionReshoots.filter((r) =>
    reshootFilter === 'all' ? true : reshootFilter === 'pending' ? !r.resolved : r.resolved,
  );

  /** 验收前置条件：航线参数已保存 + 已编目影像 + 全部合格 */
  const checks = [
    { key: 'line', label: '航线参数已保存', pass: lineSaved },
    { key: 'assets', label: '成果影像已编目（至少 1 张）', pass: totalCount > 0 },
    { key: 'quality', label: `全部影像合格（合格 ${qualifiedCount}/${totalCount}）`, pass: totalCount > 0 && qualifiedCount === totalCount },
  ];
  const canAccept = checks.every((c) => c.pass);

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

  const exportReshoots = () => {
    const header = '片号,质量原因,状态,入池时间,销项时间';
    const lines = missionReshoots.map((r) =>
      [
        r.imageNo,
        r.reason,
        r.resolved ? '已销项' : '待补拍',
        new Date(r.createdAt).toLocaleString('zh-CN'),
        r.resolvedAt ? new Date(r.resolvedAt).toLocaleString('zh-CN') : '',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `补拍清单_${mission?.missionNo ?? 'mission'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条补拍清单`);
  };

  const onAccept = async () => {
    if (!mission) return;
    if (!canAccept) {
      setError('尚未满足验收条件：请先保存航线参数，并确认全部影像均为合格');
      return;
    }
    await acceptMission(mission.id, totalCount, qualifiedCount);
    setToast(`验收通过：共 ${totalCount} 张，合格 ${qualifiedCount} 张；可返回任务台账归档`);
  };

  const reshootColumns: NonNullable<TableProps<ReshootItem>['columns']> = [
    { title: '片号', dataIndex: 'imageNo', width: 140, render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
    {
      title: '质量原因',
      dataIndex: 'reason',
      width: 110,
      render: (v: ReshootItem['reason']) => <Tag color={REASON_COLOR[v]}>{v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'resolved',
      width: 110,
      render: (v: boolean) => (v ? <Tag color="green">已销项</Tag> : <Tag color="orange">待补拍</Tag>),
    },
    { title: '入池时间', dataIndex: 'createdAt', width: 180, render: (v: number) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '销项时间',
      dataIndex: 'resolvedAt',
      width: 180,
      render: (v?: number) => (v ? new Date(v).toLocaleString('zh-CN') : '—'),
    },
    {
      title: '原片',
      dataIndex: 'assetId',
      width: 110,
      render: (v?: string) => (v && assets.some((a) => a.id === v) ? <Typography.Text type="secondary">在册</Typography.Text> : <Tag>已删除</Tag>),
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, row: ReshootItem) =>
        readOnly ? (
          <Typography.Text type="secondary">只读</Typography.Text>
        ) : (
          <Space size={4}>
            <Button size="small" type="link" disabled={row.resolved} onClick={() => resolveReshoot(row.id)}>
              补拍完成
            </Button>
            <Button size="small" type="link" danger onClick={() => removeReshoot(row.id)}>
              移除
            </Button>
          </Space>
        ),
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
        {accepted ? <Tag color="geekblue">已验收</Tag> : null}
        {mission.status === '已归档' ? <Tag color="purple">已归档（只读）</Tag> : null}
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
      {readOnly ? <Alert type="info" showIcon message="任务已归档，影像质量与补拍清单只能查看，不能再标记、删除或销项。" /> : null}

      <Row gutter={12}>
        {stats.map((s) => (
          <Col span={6} key={s.quality}>
            <Card size="small">
              <Statistic title={`${s.quality}影像`} value={s.count} suffix="张" />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={12}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="待补拍片号" value={pendingReshoots.length} suffix="张" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="航点数量" value={missionWaypoints.length} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="航线参数" value={lineSaved ? '已保存' : '未保存'} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="验收结论"
              value={mission.status === '已归档' ? '已归档' : accepted ? '已通过' : '未验收'}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="成果验收">
        {accepted ? (
          <Descriptions size="small" column={3} colon={false}>
            <Descriptions.Item label="验收时间">
              {mission.acceptedAt ? new Date(mission.acceptedAt).toLocaleString('zh-CN') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="影像总数">{mission.acceptedTotalCount ?? totalCount} 张</Descriptions.Item>
            <Descriptions.Item label="合格数">{mission.acceptedQualifiedCount ?? qualifiedCount} 张</Descriptions.Item>
            <Descriptions.Item label="归档时间">
              {mission.archivedAt ? new Date(mission.archivedAt).toLocaleString('zh-CN') : '尚未归档（可在任务台账归档）'}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Space wrap size={[16, 8]} align="center">
            {checks.map((c) => (
              <Space size={6} key={c.key}>
                <CheckCircleOutlined style={{ color: c.pass ? '#52c41a' : '#d9d9d9' }} />
                <Typography.Text type={c.pass ? undefined : 'warning'}>{c.label}</Typography.Text>
              </Space>
            ))}
            <Button type="primary" disabled={!canAccept || readOnly} onClick={onAccept}>
              通过验收
            </Button>
            {!canAccept ? (
              <Typography.Text type="secondary">航线参数保存后，且全部影像合格，才能通过验收</Typography.Text>
            ) : null}
          </Space>
        )}
      </Card>

      <Card size="small" title={`补拍清单（待补拍 ${pendingReshoots.length} 张，共 ${missionReshoots.length} 条）`}>
        <Space wrap size={10} style={{ marginBottom: 10 }}>
          <Select
            style={{ width: 140 }}
            value={reshootFilter}
            onChange={(v) => setReshootFilter(v as typeof reshootFilter)}
            options={[
              { value: 'pending', label: '待补拍' },
              { value: 'done', label: '已销项' },
              { value: 'all', label: '全部记录' },
            ]}
          />
          <Button icon={<DownloadOutlined />} onClick={exportReshoots} disabled={missionReshoots.length === 0}>
            导出补拍清单
          </Button>
          <Typography.Text type="secondary">
            标记为「模糊 / 过曝」的影像会按片号自动进入本清单并保留质量原因；复验合格或补拍完成后销项。
          </Typography.Text>
        </Space>
        <Table<ReshootItem>
          rowKey="id"
          size="small"
          columns={reshootColumns}
          dataSource={shownReshoots}
          pagination={false}
          locale={{ emptyText: '暂无补拍记录' }}
        />
      </Card>

      <Card size="small">
        <Space wrap size={10}>
          <Input
            allowClear
            disabled={readOnly}
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
          <Button type="primary" disabled={readOnly} icon={<PlusOutlined />} onClick={catalogFromWaypoints}>
            按航点批量编目
          </Button>
          <Button
            disabled={readOnly || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '合格');
              setToast(`已把 ${selected.length} 张标记为「合格」，对应补拍记录自动销项`);
            }}
          >
            标记合格
          </Button>
          <Button
            disabled={readOnly || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '模糊');
              setToast(`已把 ${selected.length} 张标记为「模糊」，已按片号进入补拍清单`);
            }}
          >
            标记模糊
          </Button>
          <Button
            disabled={readOnly || selected.length === 0}
            onClick={async () => {
              await markMany(selected, '过曝');
              setToast(`已把 ${selected.length} 张标记为「过曝」，已按片号进入补拍清单`);
            }}
          >
            标记过曝
          </Button>
          <Button
            danger
            disabled={readOnly || selected.length === 0}
            onClick={async () => {
              await removeMany(selected);
              setToast(`已删除 ${selected.length} 条影像条目（补拍清单保留待处置）`);
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
              readOnly={readOnly}
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
    </Space>
  );
}
