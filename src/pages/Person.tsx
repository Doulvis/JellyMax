import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { BaseItem } from '../api/types';
import { PosterGrid } from '../components/Card';
import { Empty, ErrorState, PageLoader } from '../components/Common';
import { t } from '../i18n';
import { errorMessage } from '../utils/format';

export default function PersonPage() {
  const { id = '' } = useParams();
  const [person, setPerson] = useState<BaseItem | null>(null);
  const [items, setItems] = useState<BaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPerson(null);
    setItems(null);
    Promise.all([
      api.item(id),
      api.items({
        personIds: id,
        recursive: true,
        includeItemTypes: 'Movie,Series',
        sortBy: 'PremiereDate,ProductionYear,SortName',
        sortOrder: 'Descending',
        limit: 200,
      }),
    ])
      .then(([p, r]) => {
        if (!alive) return;
        setPerson(p);
        setItems(r.Items);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!person || !items) return <PageLoader />;

  const img =
    person.ImageTags && person.ImageTags.Primary
      ? api.imageUrl(person.Id, 'Primary', { tag: person.ImageTags.Primary, maxWidth: 400 })
      : null;

  return (
    <div className="page">
      <div className="person">
        <div className="person__img">{img ? <img src={img} alt="" /> : person.Name.charAt(0)}</div>
        <div>
          <h1 className="page__title">{person.Name}</h1>
          {person.Overview && <p className="person__bio">{person.Overview}</p>}
        </div>
      </div>
      <h2 className="section-title">{t('person.filmography')}</h2>
      {items.length ? <PosterGrid items={items} showTitle /> : <Empty>{t('person.none')}</Empty>}
    </div>
  );
}
