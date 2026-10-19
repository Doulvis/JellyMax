// Sous-ensemble typé des DTO de l'API Jellyfin (10.9+).

export interface UserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
  PlayCount?: number;
}

export interface MediaStream {
  Index: number;
  Type: string; // Video | Audio | Subtitle | EmbeddedImage
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  DeliveryMethod?: 'Encode' | 'Embed' | 'External' | 'Hls' | 'Drop';
  DeliveryUrl?: string;
  Channels?: number;
  Width?: number;
  Height?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  BitRate?: number;
}

export interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
  Bandwidth?: number;
}

export interface MediaSource {
  Id: string;
  Container?: string;
  Name?: string;
  Protocol?: string;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  MediaStreams?: MediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  ETag?: string;
  Bitrate?: number;
  LiveStreamId?: string;
}

export interface Person {
  Id: string;
  Name: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface NameId {
  Id: string;
  Name: string;
}

export interface BaseItem {
  Id: string;
  Name: string;
  Type: string;
  ServerId?: string;
  OriginalTitle?: string;
  Overview?: string;
  Taglines?: string[];
  ProductionYear?: number;
  PremiereDate?: string;
  EndDate?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  GenreItems?: NameId[];
  Studios?: NameId[];
  People?: Person[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  UserData?: UserData;
  MediaSources?: MediaSource[];
  MediaStreams?: MediaStream[];
  Trickplay?: Record<string, Record<string, TrickplayInfo>>;
  RemoteTrailers?: { Url: string; Name?: string }[];
  ChildCount?: number;
  RecursiveItemCount?: number;
  CollectionType?: string;
  Status?: string;
  DateCreated?: string;
  IsFolder?: boolean;
}

export interface ItemsResult {
  Items: BaseItem[];
  TotalRecordCount: number;
  StartIndex?: number;
}

export interface UserDto {
  Id: string;
  Name: string;
  ServerId?: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
  HasConfiguredPassword?: boolean;
  Policy?: { IsAdministrator?: boolean };
}

export interface AuthResult {
  User: UserDto;
  AccessToken: string;
  ServerId: string;
}

export interface PublicSystemInfo {
  ServerName: string;
  Version: string;
  Id: string;
  ProductName?: string;
  StartupWizardCompleted?: boolean;
}

export interface PlaybackInfoResponse {
  MediaSources: MediaSource[];
  PlaySessionId: string;
  ErrorCode?: string;
}

export interface MediaSegment {
  Id: string;
  ItemId: string;
  Type: 'Unknown' | 'Commercial' | 'Preview' | 'Recap' | 'Outro' | 'Intro';
  StartTicks: number;
  EndTicks: number;
}
