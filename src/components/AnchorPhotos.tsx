import { Camera } from 'lucide-react';
export type AnchorRole = 'start' | 'end';
export function AnchorPhotos({
  moment,
  selected,
  notices,
  onSelect,
}: {
  moment: boolean;
  selected: Record<AnchorRole, boolean>;
  notices: Partial<Record<AnchorRole, string>>;
  onSelect: (role: AnchorRole, file?: File) => void;
}) {
  return (
    <section className="anchor-panel" aria-label="锚定照片自动填写">
      <strong>
        <Camera size={17} /> 用照片锚定这段时光
      </strong>
      <p className="small muted">
        仅下面明确选择的照片解析拍摄时间和
        GPS，并预填对应节点。普通附件照片不会解析。请核对后保存记录。
      </p>
      <div className="anchor-grid">
        {(['start', ...(moment ? [] : ['end'])] as AnchorRole[]).map((role) => (
          <div className="anchor-slot" key={role}>
            <label className="upload-label">
              <Camera size={16} />
              {role === 'start' ? '开始锚定照片' : '结束锚定照片'}
              <input
                aria-label={role === 'start' ? '开始锚定照片' : '结束锚定照片'}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  onSelect(role, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="small muted">
              {selected[role]
                ? '已选择 · 再选一张可更换，原照片保留为普通附件'
                : '可先上传照片，再补充其他信息'}
            </p>
            {selected[role] && notices[role] && (
              <p className="small anchor-result" role="status">
                {notices[role]}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="small muted">
        拍摄信息在本机解析，有 GPS
        时联网查询地名，仅发送坐标。只有可用信息才替换本端字段；照片缺失的信息需手动补齐。移除锚定照片不会撤销已填写内容。
      </p>
    </section>
  );
}
