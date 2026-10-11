import { useState } from 'react';
import { Archive, Download, FileJson, LoaderCircle, Upload } from 'lucide-react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import type { TripDocument } from '../models';
import { backupData, download, exportZip, readBackup, importBackup } from '../services/backup';
import { message } from '../lib/utils';
export function BackupDialog({
  docs,
  ownerId,
  onClose,
  onImported,
  readonly,
}: {
  docs: TripDocument[];
  ownerId: string;
  onClose: () => void;
  onImported: () => Promise<void>;
  readonly: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const [staged, setStaged] = useState<Awaited<ReturnType<typeof readBackup>>>();
  async function zip() {
    setBusy(true);
    setError('');
    try {
      download(await exportZip(docs), 'tripflow-full-backup.zip');
      setStatus('完整 ZIP 已生成，包含 JSON 与所有实际照片。');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function prepare(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setStaged(undefined);
    try {
      const data = await readBackup(file);
      setStaged(data);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!staged) return;
    setBusy(true);
    setError('');
    try {
      const added = await importBackup(staged, ownerId);
      await onImported();
      setStatus(`成功导入 ${added.length} 段旅行，作为新旅行保存。`);
      setStaged(undefined);
    } catch (e) {
      await onImported();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="把旅程，妥善收藏"
      description="独立文件备份，始终由你自己保管。"
      onClose={() => !busy && onClose()}
    >
      <div className="form-body">
        <div className="backup-option">
          <FileJson size={25} />
          <div>
            <strong>JSON 数据备份</strong>
            <p className="small muted">
              含全部 {docs.length} 段旅行、地点、记录和附件引用；不含照片文件。
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              download(
                new Blob([JSON.stringify(backupData(docs), null, 2)], { type: 'application/json' }),
                'tripflow-backup.json'
              )
            }
          >
            <Download size={16} />
            导出
          </Button>
        </div>
        <div className="backup-option">
          <Archive size={25} />
          <div>
            <strong>完整 ZIP 备份</strong>
            <p className="small muted">
              包含真实照片文件，可在其他设备完整恢复。缺少照片时会明确报错。
            </p>
          </div>
          <Button variant="outline" onClick={zip} disabled={busy}>
            <Download size={16} />
            导出
          </Button>
        </div>
        <hr />
        <label className={`backup-import ${readonly ? 'disabled' : ''}`}>
          <Upload size={23} />
          <strong>导入 JSON 或 ZIP</strong>
          <span className="small muted">将校验格式并创建新旅行，不覆盖已有内容</span>
          <input
            aria-label="导入备份"
            type="file"
            accept=".json,.zip"
            disabled={busy || readonly}
            onChange={(e) => {
              void prepare(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {staged && (
          <div className="notice">
            <p>
              已校验 {staged.backup.documents.length} 段旅行、{staged.blobs.size} 个照片文件。
            </p>
            <p className="small">
              {staged.blobs.size === 0
                ? 'JSON 仅恢复照片引用，图片会标记为待恢复。'
                : '图片将上传至当前账户的私有存储。'}
            </p>
            <Button disabled={busy || readonly} onClick={restore}>
              确认导入为新旅行
            </Button>
          </div>
        )}
        {busy && (
          <p className="small muted flex items-center gap-2">
            <LoaderCircle className="spin" size={16} />
            正在处理，请保持窗口打开…
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="notice success" role="status">
            {status}
          </p>
        )}
      </div>
    </Modal>
  );
}
