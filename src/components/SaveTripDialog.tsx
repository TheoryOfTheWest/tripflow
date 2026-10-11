import { useState } from 'react';
import { Archive, Download, LoaderCircle } from 'lucide-react';
import type { TripDocument } from '../models';
import { download, exportTripArchive, tripArchiveName } from '../services/backup';
import { message } from '../lib/utils';
import { Button } from './ui/button';
import { Modal } from './ui/modal';

export function SaveTripDialog({ doc, onClose }: { doc: TripDocument; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    setFilename('');
    try {
      const blob = await exportTripArchive(doc);
      const name = tripArchiveName(doc);
      download(blob, name);
      setFilename(name);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="保存这段旅程到电脑"
      description="生成独立的旅程文件，由你保管，随时阅读或恢复。"
      onClose={() => !busy && onClose()}
    >
      <div className="form-body">
        <div className="notice">
          <strong>{doc.trip.title}</strong>
          <p className="small">
            {doc.trip.startDate} — {doc.trip.endDate} · {doc.entries.length} 段记录 ·{' '}
            {doc.photos.length} 张照片
          </p>
        </div>
        <p className="small">
          确认后下载一个
          ZIP，包含本段旅程已保存的全部记录、地点、路线和实际照片，以及离线图文回顾。未提交的表单内容不会包含在文件中。
        </p>
        <ol className="archive-steps small">
          <li>直接阅读：解压 ZIP，打开“旅程回顾.html”，保留旁边的 photos 文件夹。</li>
          <li>继续记录：启动本地 TripFlow，点击首页“导入旅程”，选择这个 ZIP 恢复为新旅行。</li>
        </ol>
        <p className="small muted">
          文件通常保存在浏览器的下载文件夹，也可能提示你选择位置。后续修改旅程后，请再次保存下载。
        </p>
        {busy && (
          <p role="status" className="small">
            <LoaderCircle className="spin inline" size={16} /> 正在打包记录和照片，请保持窗口打开…
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {filename && (
          <div className="notice success" role="status">
            <p>旅程文件已生成并发起下载，请在浏览器下载列表确认保存完成。</p>
            <p className="archive-filename small">{filename}</p>
          </div>
        )}
        <footer className="form-footer">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {filename ? '完成' : '取消'}
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : filename ? (
              <Download size={16} />
            ) : (
              <Archive size={16} />
            )}
            {busy ? '正在生成…' : filename ? '再次下载' : '确认保存并下载'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
