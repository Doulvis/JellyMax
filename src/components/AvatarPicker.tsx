import { useEffect, useMemo, useRef, useState } from 'react';
import { JellyfinApi, type GalleryAvatar } from '../api/client';
import { t } from '../i18n';
import { isBackKey, isTV } from '../platform';
import type { Profile } from '../state/auth';
import { errorMessage } from '../utils/format';
import { Avatar, Spinner } from './Common';
import { Close, Trash, Upload } from './Icons';

/** Recadre l'image au carré, la réduit à 512 px et l'encode en JPEG base64. */
async function fileToJpegBase64(file: File, size = 512): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Choix de l'avatar d'un profil. Les avatars proposés sont ceux de la galerie du serveur Jellyfin
 * (plugin GetAvatar) ; l'avatar choisi devient la photo de profil Jellyfin, donc synchronisée partout.
 */
export function AvatarPicker({
  profile,
  onClose,
  onUpdated,
}: {
  profile: Profile;
  onClose(): void;
  onUpdated(tag: string | undefined): void;
}) {
  const client = useMemo(() => {
    const c = new JellyfinApi();
    c.configure(profile.serverUrl, profile.accessToken, profile.userId);
    return c;
  }, [profile.serverUrl, profile.accessToken, profile.userId]);

  const [gallery, setGallery] = useState<GalleryAvatar[] | null | undefined>(undefined);
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    client.avatarGallery().then((g) => alive && setGallery(g));
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      const me = await client.me();
      onUpdated(me ? me.PrimaryImageTag : undefined);
      onClose();
    } catch (e) {
      setError(`${t('avatar.error')} ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const categories = gallery ? Array.from(new Set(gallery.map((a) => a.category).filter(Boolean))).sort() : [];
  const shown = gallery ? gallery.filter((a) => !category || a.category === category) : [];

  return (
    <div className="modal" data-nav-scope onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__card" role="dialog" aria-modal="true" aria-label={t('avatar.title')}>
        <div className="modal__head">
          <Avatar userId={profile.userId} tag={profile.userImageTag} name={profile.userName} server={profile.serverUrl} size="lg" />
          <div className="modal__titles">
            <h2>{t('avatar.title')}</h2>
            <p>
              {profile.userName} · {t('avatar.synced')}
            </p>
          </div>
          <button className="pbtn" onClick={onClose} aria-label={t('common.close')}>
            <Close />
          </button>
        </div>

        {gallery === undefined ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : gallery === null || gallery.length === 0 ? (
          <p className="modal__hint">{t(gallery === null ? 'avatar.noGallery' : 'avatar.empty')}</p>
        ) : (
          <>
            {categories.length > 1 && (
              <div className="chips chips--modal">
                <button className={`chip ${category === '' ? 'is-active' : ''}`} onClick={() => setCategory('')}>
                  {t('avatar.all')}
                </button>
                {categories.map((c) => (
                  <button key={c} className={`chip ${category === c ? 'is-active' : ''}`} onClick={() => setCategory(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="avatar-grid">
              {shown.map((a) => (
                <button
                  key={a.id}
                  className={`avatar-choice ${busy === a.id ? 'is-busy' : ''}`}
                  title={a.name}
                  aria-label={a.name}
                  disabled={!!busy}
                  onClick={() => run(a.id, () => client.setGalleryAvatar(a.id))}
                >
                  <img src={a.url} alt="" loading="lazy" />
                  {busy === a.id && <Spinner size="sm" />}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal__foot">
          {/* Pas de sélecteur de fichiers sur TV. */}
          {!isTV && (
            <button className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => fileRef.current && fileRef.current.click()}>
              {busy === 'upload' ? <Spinner size="sm" /> : <Upload />} {t('avatar.upload')}
            </button>
          )}
          {profile.userImageTag && (
            <button className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => run('delete', () => client.deleteUserImage())}>
              {busy === 'delete' ? <Spinner size="sm" /> : <Trash />} {t('avatar.remove')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              e.target.value = '';
              if (file) run('upload', async () => client.uploadUserImage(await fileToJpegBase64(file), 'image/jpeg'));
            }}
          />
        </div>
      </div>
    </div>
  );
}
