import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { BaseItem } from '../api/types';
import { BrowseGrid } from '../components/BrowseGrid';
import { ErrorState, PageLoader } from '../components/Common';
import { t } from '../i18n';
import { errorMessage } from '../utils/format';

function typesFor(collectionType?: string) {
  switch (collectionType) {
    case 'movies':
      return 'Movie';
    case 'tvshows':
      return 'Series';
    case 'boxsets':
      return 'BoxSet';
    default:
      return 'Movie,Series,Video,BoxSet';
  }
}

/** Contenu d'une médiathèque Jellyfin précise (collections, vidéos personnelles…). */
export default function LibraryRoute() {
  const { parentId = '' } = useParams();
  return <Library key={parentId} parentId={parentId} />;
}

function Library({ parentId }: { parentId: string }) {
  const [view, setView] = useState<BaseItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genres, setGenres] = useState<BaseItem[]>([]);
  const [genre, setGenre] = useState('');

  useEffect(() => {
    api
      .item(parentId)
      .then((v) => {
        setView(v);
        return api.genres({ parentId, includeItemTypes: typesFor(v.CollectionType) });
      })
      .then((r) => setGenres(r.Items || []))
      .catch((e) => setError(errorMessage(e)));
  }, [parentId]);

  if (error) return <ErrorState message={error} />;
  if (!view) return <PageLoader />;
  return (
    <div className="page-flush">
      <div className="page-head">
        <h1 className="page__title">{view.Name}</h1>
      </div>
      <div className="rails">
        <BrowseGrid
          title={t('browse.allContent')}
          types={typesFor(view.CollectionType)}
          parentId={parentId}
          genres={view.CollectionType === 'boxsets' ? [] : genres}
          genre={genre}
          onGenre={setGenre}
        />
      </div>
    </div>
  );
}
