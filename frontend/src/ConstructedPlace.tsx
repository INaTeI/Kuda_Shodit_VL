import { useState, type CSSProperties } from "react";
import { price, type Place } from "./api";
import { PlaceMap } from "./PlaceMap";
import { Reactions } from "./components";

const backgrounds: Record<string, string> = {
  paper: "#F6F7F5", white: "#FFFFFF", mist: "#E6F0EF", lagoon: "#D3ECEE",
  sand: "#F3E9D8", dawn: "#F6D9CB", teal: "#157F8C", pine: "#2F5D50",
  deep: "#16343B", night: "#0F1E24",
};
const texts: Record<string, string> = {
  ink: "#16343B", graphite: "#3F4F53", teal: "#106775", white: "#FFFFFF", sand: "#F3E9D8",
};
const pageBackgrounds: Record<string, string> = {
  plain: "#F7F8F5", paper: "#F3EEE4", sea: "#DCEFEB", night: "#12242A",
  sunrise: "linear-gradient(145deg,#F6D9CB 0%,#F3E9D8 48%,#D3ECEE 100%)",
  ocean: "linear-gradient(145deg,#D3ECEE 0%,#8FC7CC 48%,#326F7B 100%)",
  dusk: "linear-gradient(145deg,#16343B 0%,#476277 52%,#D59E89 100%)",
  mist: "linear-gradient(180deg,#F6F7F5 0%,#DCEFEB 100%)",
};
const blockIds = ["gallery", "title", "price", "address", "description", "extra1", "extra2"] as const;
type BlockId = typeof blockIds[number];
type BlockConfig = { bg?: string; text?: string; textCustom?: string; size?: string; width?: string; hidden?: boolean };
export type ConstructorState = {
  page?: { order?: string[]; background?: string; blocks?: Record<string, BlockConfig>; custom?: Record<string, { title?: string; body?: string }> };
  place?: { accent?: number; photos?: { id: string; src: string; alt?: string }[]; mainId?: string };
};

function luminance(color: string) {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function colors(config: BlockConfig): CSSProperties {
  const bg = backgrounds[config.bg || ""] || backgrounds.white;
  const automatic = contrast(bg, "#16343B") >= contrast(bg, "#FFFFFF") ? "#16343B" : "#FFFFFF";
  const requested = texts[config.text || ""];
  const custom = /^#[0-9a-f]{6}$/i.test(config.textCustom || "") ? config.textCustom : undefined;
  const foreground = custom && contrast(custom, bg) >= 4.5 ? custom : requested && contrast(requested, bg) >= 4.5 ? requested : automatic;
  const accent = ["#157F8C", "#106775", "#8FD6DE"].find((color) => contrast(color, bg) >= 3) || foreground;
  return { "--place-block-bg": bg, "--place-block-text": foreground, "--place-block-accent": accent,
    "--place-block-border": luminance(bg) > 0.6 ? "#DFE7E5" : "transparent" } as CSSProperties;
}
function safePhoto(src: string) {
  return src.startsWith("/places/") || src.startsWith("https://") || /^data:image\/(jpeg|png|webp);base64,/.test(src);
}

export function ConstructedPlace({ place, state }: { place: Place; state: ConstructorState }) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const order = (state.page?.order || []).filter((id): id is BlockId => blockIds.includes(id as BlockId));
  const uniqueOrder = [...new Set(order)];
  const photos = (state.place?.photos || []).filter((photo) => photo && safePhoto(photo.src));
  const mainPhoto = photos.find((photo) => photo.id === state.place?.mainId) || photos[0];
  const shownPhoto = photos.find((photo) => photo.id === selectedPhoto) || mainPhoto;
  const words = place.name.trim().split(/\s+/);
  const accent = state.place?.accent ?? -1;
  const backgroundId = state.page?.background || "plain";
  return <div className={`constructed-surface ${backgroundId === "night" || backgroundId === "dusk" ? "dark" : ""}`} style={{ background: pageBackgrounds[backgroundId] || pageBackgrounds.plain }}>
    <div className="constructed-grid">
      {uniqueOrder.map((id) => {
        const config = state.page?.blocks?.[id] || {};
        if (config.hidden) return null;
        const size = ["S", "M", "L"].includes(config.size || "") ? config.size : "M";
        return <section key={id} className={`constructed-block ${config.width === "half" ? "half" : "full"}`} data-type={id} data-size={size} style={colors(config)}>
          <div className="constructed-block-inner">
            {id === "title" && <><div className="constructed-category">{place.categories.map((category) => category.name).join(" · ")}</div>
              <h1>{words.map((word, index) => <span key={index}>{index > 0 ? " " : ""}{index === accent ? <em>{word}</em> : word}</span>)}</h1></>}
            {id === "description" && <><p className="constructed-label">О месте</p>{place.description.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</>}
            {id === "address" && <><p className="constructed-label">Адрес</p><p className="constructed-address">{place.address || "Адрес не указан"}</p>
              {place.latitude !== null && place.longitude !== null && <a href="#place-location">Открыть на карте ↗</a>}</>}
            {id === "price" && <><p className="constructed-label">Стоимость</p><div className="constructed-amount">{price(place)}</div>
              <p className="constructed-note">{place.price_note}{place.checked_at ? ` · проверено ${new Date(place.checked_at + "T00:00:00").toLocaleDateString("ru-RU")}` : ""}</p></>}
            {id === "gallery" && (shownPhoto ? <><div className="constructed-main-photo"><img src={shownPhoto.src} alt={shownPhoto.alt || place.name} /></div>
              {photos.length > 1 && <div className="constructed-thumbnails" role="group" aria-label="Фотографии места">{photos.map((photo, index) => <button key={photo.id} type="button" aria-label={`Фото ${index + 1} из ${photos.length}`} aria-pressed={photo.id === shownPhoto.id} onClick={() => setSelectedPhoto(photo.id)}><img src={photo.src} alt="" /></button>)}</div>}</> :
              <div className="constructed-photo-empty">Фото пока нет</div>)}
            {(id === "extra1" || id === "extra2") && <><h2>{state.page?.custom?.[id]?.title || "Новый блок"}</h2><p>{state.page?.custom?.[id]?.body || ""}</p></>}
          </div>
        </section>;
      })}
    </div>
    <div className="constructed-extra">
      <Reactions id={place.id} />
      {place.activity && <><h2>Чем здесь заняться</h2><p>{place.activity}</p></>}
      {place.visiting_notes && <><h2>Перед выходом</h2><p>{place.visiting_notes}</p></>}
      <div id="place-location"><h2>Где находится</h2><PlaceMap key={place.id} latitude={place.latitude} longitude={place.longitude} name={place.name} /></div>
      {place.opening_hours && <p>Часы работы: {place.opening_hours}</p>}
      {place.source_url && /^https?:\/\//i.test(place.source_url) && <a href={place.source_url} target="_blank" rel="noreferrer">Источник сведений ↗</a>}
    </div>
  </div>;
}
