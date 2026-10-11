import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { Button } from './ui/button';
import { message } from '../lib/utils';
import {
  type PhotoAutoDraft,
  type PhotoDraft,
  type PhotoGroup,
  type DraftLocation,
  emptyAutoDraft,
  coordinates,
  parseDraftPhoto,
  groupPhotos,
  namePhotoGroups,
  setGroupAnchor,
  draftTimeLabel,
  MAX_BATCH_PHOTOS,
  MAX_BATCH_BYTES,
} from '../services/photoTimeline';

function DraftImage({ photo }: { photo?: PhotoDraft }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!photo) {
      setUrl('');
      return;
    }
    const value = URL.createObjectURL(photo.blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [photo]);
  return url ? (
    <img className="auto-anchor-image" src={url} alt={photo?.fileName || '锚定照片'} />
  ) : null;
}
export function PhotoOffset({
  value,
  zone,
  offset,
  onChange,
}: {
  value: string;
  zone: string;
  offset?: number;
  onChange: (offset: number | undefined) => void;
}) {
  const choices = DateTime.fromISO(value, { zone }).getPossibleOffsets();
  if (choices.length < 2) return null;
  return (
    <label>
      重复时刻的 UTC 偏移
      <select
        aria-label="照片 UTC 偏移"
        value={offset ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      >
        <option value="">请选择以确认实际时间</option>
        {choices.map((choice) => (
          <option key={choice.offset} value={choice.offset}>
            {choice.toFormat('ZZ')}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PhotoAutoMode({
  value,
  zone,
  disabled,
  onChange,
  onBusyChange,
}: {
  value: PhotoAutoDraft;
  zone: string;
  disabled: boolean;
  onChange: (value: PhotoAutoDraft) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [loading, setLoading] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const [radius, setRadius] = useState(200),
    [gap, setGap] = useState(90);
  const lock = useRef(false),
    stop = useRef(false);
  const begin = () => {
    if (lock.current || disabled) return false;
    lock.current = true;
    stop.current = false;
    setLoading(true);
    onBusyChange(true);
    setError('');
    return true;
  };
  const finish = () => {
    lock.current = false;
    setLoading(false);
    onBusyChange(false);
  };
  async function regroup(photos = value.photos, failures = value.failures) {
    const result = groupPhotos(photos, zone, radius, gap);
    const named = stop.current
      ? { groups: result.groups, notice: '已停止后续处理；已完成的照片保留为草稿。' }
      : await namePhotoGroups(
          result.groups,
          (done, total) => setProgress(`正在识别分组地点 ${done} / ${total}`),
          () => stop.current
        );
    onChange({
      photos,
      groups: named.groups,
      dirty: false,
      failures,
      notice: `${result.unresolved.length ? `${result.unresolved.length} 张照片时间待纠正或暂不导入。` : ''}${named.notice}`,
    });
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !begin()) return;
    try {
      if (files.length + value.photos.length > MAX_BATCH_PHOTOS)
        throw new Error(`每批最多 ${MAX_BATCH_PHOTOS} 张照片，可保存后继续追加另一批`);
      if ([...files].reduce((sum, file) => sum + file.size, 0) > 1024 * 1024 * 1024)
        throw new Error('本次原图合计不能超过 1 GB，请分批选择');
      const photos = [...value.photos],
        failures = [...value.failures];
      let bytes = photos.reduce((sum, photo) => sum + photo.blob.size, 0);
      for (const [i, file] of [...files].entries()) {
        if (stop.current) break;
        setProgress(`正在解析与压缩照片 ${i + 1} / ${files.length}`);
        try {
          const photo = await parseDraftPhoto(file, zone);
          if (bytes + photo.blob.size > MAX_BATCH_BYTES) {
            failures.push(`${file.name}：本批压缩照片达到 80 MB 上限，其余文件未处理，请分批导入`);
            break;
          }
          bytes += photo.blob.size;
          photos.push(photo);
        } catch (e) {
          failures.push(`${file.name}：${message(e)}`);
        }
      }
      await regroup(photos, failures);
    } catch (e) {
      setError(message(e));
    } finally {
      finish();
    }
  }
  async function regenerate() {
    if (!begin()) return;
    try {
      await regroup();
    } catch (e) {
      setError(message(e));
    } finally {
      finish();
    }
  }
  async function retryNames() {
    if (!begin()) return;
    try {
      const result = await namePhotoGroups(
        value.groups,
        (done, total) => setProgress(`识别地名 ${done} / ${total}`),
        () => stop.current
      );
      onChange({ ...value, ...result });
    } catch (e) {
      setError(message(e));
    } finally {
      finish();
    }
  }
  function editPhoto(id: string, patch: Partial<PhotoDraft>) {
    onChange({
      ...value,
      photos: value.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      dirty: true,
    });
  }
  function editGroup(id: string, patch: Partial<PhotoGroup>) {
    onChange({ ...value, groups: value.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  }
  async function chooseAnchor(group: PhotoGroup, role: 'start' | 'end', id: string) {
    if (!id) {
      editGroup(group.id, setGroupAnchor(group, role));
      return;
    }
    if (!begin()) return;
    try {
      const photo = value.photos.find((p) => p.id === id);
      const next = setGroupAnchor(group, role, photo);
      if (photo && coordinates(photo)) {
        const named = await namePhotoGroups([next], undefined, undefined, [
          role === 'start' ? 'startLocation' : 'endLocation',
        ]);
        editGroup(group.id, named.groups[0]);
      } else editGroup(group.id, next);
    } catch (e) {
      setError(message(e));
    } finally {
      finish();
    }
  }
  const locked = disabled || loading;
  return (
    <section className="photo-auto-mode" aria-label="上传照片自动解析模式">
      <h3>
        <Camera size={18} /> 上传照片自动解析模式
      </h3>
      <p className="small muted">
        在此模式中，明确选入的全部照片都会解析时间和
        GPS。先生成草稿，核对后保存；普通附件入口保持不解析。照片原图不上传识别，GPS
        坐标会发送到地图服务查询附近地名。
      </p>
      <fieldset disabled={locked} className="form-fieldset">
        <label className="upload-label auto-upload">
          <Camera size={18} /> 选择旅程照片
          <input
            aria-label="批量旅程照片"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <p className="small muted">
          支持 JPG / PNG / WebP，每批最多 200 张、原图合计 1 GB、压缩后 80
          MB。再次选择会追加草稿；已有旅程记录保留。先设置默认时区，再选照片。
        </p>
        <div className="form-grid">
          <label>
            同地点范围（米）
            <input
              aria-label="同地点范围（米）"
              type="number"
              min={1}
              max={5000}
              value={radius}
              onChange={(e) => {
                setRadius(Number(e.target.value));
                onChange({ ...value, dirty: true });
              }}
            />
          </label>
          <label>
            连续间隔（分钟）
            <input
              aria-label="连续间隔（分钟）"
              type="number"
              min={1}
              max={1440}
              value={gap}
              onChange={(e) => {
                setGap(Number(e.target.value));
                onChange({ ...value, dirty: true });
              }}
            />
          </label>
        </div>
        {value.photos.length > 0 && (
          <>
            <div className="auto-actions">
              <Button type="button" variant="outline" onClick={() => void regenerate()}>
                按纠正信息重新分组
              </Button>
              <Button type="button" variant="ghost" onClick={() => void retryNames()}>
                重试识别地名
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onChange(emptyAutoDraft());
                  setError('');
                  setProgress('');
                }}
              >
                清空待生成照片
              </Button>
            </div>
            <p className="small muted">
              {value.photos.filter((p) => !p.excluded).length} 张待导入照片 · {value.groups.length}{' '}
              段草稿。重新分组会重新选择锚点，并覆盖下面尚未保存的分组修改。
            </p>
            {value.dirty && (
              <p role="status" className="notice">
                照片信息或合并规则已改变，请先重新分组再保存。
              </p>
            )}
            {value.notice && (
              <p role="status" className="small muted">
                {value.notice}
              </p>
            )}
            <details className="auto-corrections">
              <summary>照片信息纠错与暂不导入（{value.photos.length} 张）</summary>
              <p className="small muted">
                没有时间的照片请补填时间，或勾选“本次不导入”。没有 GPS
                的照片单独生成随记，不推测地点。无时区偏移时按 {zone} 解释，可在此核对纠正。
              </p>
              {value.photos.map((photo, index) => (
                <div className="auto-photo-row" key={photo.id}>
                  <strong>
                    {index + 1}. {photo.fileName}
                  </strong>
                  <p className="small muted">{photo.warnings.join('。')}</p>
                  <label>
                    拍摄时间
                    <input
                      aria-label={`照片 ${index + 1} 拍摄时间`}
                      type="datetime-local"
                      step={1}
                      value={photo.time}
                      onChange={(e) =>
                        editPhoto(photo.id, { time: e.target.value, offset: undefined })
                      }
                    />
                  </label>
                  <PhotoOffset
                    value={photo.time}
                    zone={zone}
                    offset={photo.offset}
                    onChange={(offset) => editPhoto(photo.id, { offset })}
                  />
                  <div className="form-grid">
                    <label>
                      纬度
                      <input
                        aria-label={`照片 ${index + 1} 纬度`}
                        value={photo.latitude}
                        onChange={(e) => editPhoto(photo.id, { latitude: e.target.value })}
                      />
                    </label>
                    <label>
                      经度
                      <input
                        aria-label={`照片 ${index + 1} 经度`}
                        value={photo.longitude}
                        onChange={(e) => editPhoto(photo.id, { longitude: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="auto-check">
                    <input
                      type="checkbox"
                      checked={photo.excluded}
                      onChange={(e) => editPhoto(photo.id, { excluded: e.target.checked })}
                    />
                    本次不导入
                  </label>
                </div>
              ))}
            </details>
            <div className="auto-groups">
              {value.groups.map((group, index) => (
                <article
                  className="auto-group"
                  key={group.id}
                  aria-label={`自动时间线第 ${index + 1} 段`}
                >
                  <h4>
                    第 {index + 1} 段 · {group.photoIds.length} 张照片
                  </h4>
                  <label>
                    记录名称
                    <input
                      aria-label={`第 ${index + 1} 段名称`}
                      maxLength={300}
                      value={group.title}
                      onChange={(e) => editGroup(group.id, { title: e.target.value })}
                    />
                  </label>
                  <div className="auto-anchor-columns">
                    {(['start', 'end'] as const).map((role) => {
                      const id = role === 'start' ? group.startPhotoId : group.endPhotoId,
                        photo = value.photos.find((p) => p.id === id),
                        locationKey = role === 'start' ? 'startLocation' : 'endLocation',
                        location = group[locationKey],
                        label = role === 'start' ? '开始' : '结束';
                      const changeLocation = (patch: Partial<DraftLocation>) =>
                        editGroup(group.id, { [locationKey]: { ...location, ...patch } });
                      return (
                        <section key={role} className="auto-node">
                          <label>
                            {label}锚定照片
                            <select
                              aria-label={`第 ${index + 1} 段${label}锚定照片`}
                              value={id}
                              onChange={(e) => void chooseAnchor(group, role, e.target.value)}
                            >
                              <option value="">不设锚定照片（图片仍保留）</option>
                              {group.photoIds.map((pid) => {
                                const p = value.photos.find((p) => p.id === pid)!;
                                return (
                                  <option value={pid} key={pid}>
                                    {p.fileName} · {draftTimeLabel(p, zone)}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                          <DraftImage photo={photo} />
                          <label>
                            {label}时间
                            <input
                              aria-label={`第 ${index + 1} 段${label}时间`}
                              type="datetime-local"
                              step={1}
                              value={role === 'start' ? group.start : group.end}
                              onChange={(e) =>
                                editGroup(
                                  group.id,
                                  role === 'start'
                                    ? { start: e.target.value, startOffset: undefined }
                                    : { end: e.target.value, endOffset: undefined }
                                )
                              }
                            />
                          </label>
                          <PhotoOffset
                            value={role === 'start' ? group.start : group.end}
                            zone={zone}
                            offset={role === 'start' ? group.startOffset : group.endOffset}
                            onChange={(offset) =>
                              editGroup(
                                group.id,
                                role === 'start' ? { startOffset: offset } : { endOffset: offset }
                              )
                            }
                          />
                          <label>
                            {label}地名
                            <input
                              aria-label={`第 ${index + 1} 段${label}地名`}
                              value={location.name}
                              maxLength={300}
                              onChange={(e) => changeLocation({ name: e.target.value })}
                            />
                          </label>
                          <p className="small muted">{location.address}</p>
                          <div className="form-grid">
                            <label>
                              纬度
                              <input
                                aria-label={`第 ${index + 1} 段${label}纬度`}
                                value={location.latitude}
                                onChange={(e) =>
                                  changeLocation({ latitude: e.target.value, address: '' })
                                }
                              />
                            </label>
                            <label>
                              经度
                              <input
                                aria-label={`第 ${index + 1} 段${label}经度`}
                                value={location.longitude}
                                onChange={(e) =>
                                  changeLocation({ longitude: e.target.value, address: '' })
                                }
                              />
                            </label>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <p className="small muted">
                    只将选中的首尾照片标为锚点，其他照片保留为附件。移除锚点不删除图片或撤销字段。相同起止时刻生成单个随记，仅保留开始锚点。
                  </p>
                  <label>
                    记录备注
                    <textarea
                      aria-label={`第 ${index + 1} 段备注`}
                      value={group.notes}
                      maxLength={10000}
                      onChange={(e) => editGroup(group.id, { notes: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        ...value,
                        groups: value.groups.filter((g) => g.id !== group.id),
                        photos: value.photos.map((p) =>
                          group.photoIds.includes(p.id) ? { ...p, excluded: true } : p
                        ),
                      })
                    }
                  >
                    本次不导入这一段
                  </Button>
                </article>
              ))}
            </div>
          </>
        )}
        {value.failures.length > 0 && (
          <details open className="notice error">
            <summary>{value.failures.length} 项未处理，请核对</summary>
            {value.failures.map((failure, index) => (
              <p className="small" key={index}>
                {failure}
              </p>
            ))}
          </details>
        )}
      </fieldset>
      {loading && (
        <div className="auto-progress" role="status">
          <LoaderCircle size={16} className="spin" />
          {progress}
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              stop.current = true;
              setProgress('正在停止，当前处理完成后保留草稿…');
            }}
          >
            停止后续解析
          </Button>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
