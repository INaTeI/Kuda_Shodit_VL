// Оформление мест из конструктора (/constructor/). Справочники совпадают с
// app/editor/schemas.py и design/place-constructor/index.html.
import { useEffect, useState, type CSSProperties } from "react";
import { api, price, type CardStyle, type Place } from "./api";

export type { CardStyle };

export type BlockId = "gallery" | "title" | "price" | "address" | "description";
export interface BlockStyle {
  bg: string;
  text: string;
  size: "S" | "M" | "L";
  width: "full" | "half";
  hidden: boolean;
}
export interface PlaceDesign {
  place_id: string;
  revision: number;
  title_accent: number | null;
  page: { preset: string | null; order: BlockId[]; blocks: Record<BlockId, BlockStyle> };
  card: CardStyle;
  photos: { id: string; url: string; alt: string }[];
  main_photo_id: string | null;
}

const BG: Record<string, string> = {
  paper: "#F6F7F5", white: "#FFFFFF", mist: "#E6F0EF", lagoon: "#D3ECEE", sand: "#F3E9D8",
  dawn: "#F6D9CB", teal: "#157F8C", pine: "#2F5D50", deep: "#16343B", night: "#0F1E24",
};
const TEXT: Record<string, string> = {
  ink: "#16343B", graphite: "#3F4F53", teal: "#106775", white: "#FFFFFF", sand: "#F3E9D8",
};
export const EMOJI: Record<string, [string, string]> = {
  smile: ["🙂", "Улыбка"], grin: ["😀", "Радость"], wave: ["🌊", "Море"], coffee: ["☕", "Кофе"],
  art: ["🎨", "Искусство"], music: ["🎶", "Музыка"], love: ["😍", "Восторг"], fire: ["🔥", "Огонь"],
  sunset: ["🌅", "Закат"], star: ["⭐", "Звезда"], gem: ["💎", "Находка"], trophy: ["🏆", "Лучшее"],
};
export const STICKERS: Record<string, string> = {
  new: "Новинка", seaview: "Вид на море", cozy: "Тихо и уютно", kids: "Можно с детьми",
  date: "Для свидания", hit: "Хит сезона", editor: "Выбор редакции",
};

function lum(hex: string) {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a: string, b: string) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const autoText = (bg: string) => (ratio(bg, "#16343B") >= ratio(bg, "#FFFFFF") ? "#16343B" : "#FFFFFF");

/** CSS-переменные блока или карточки. Нечитаемые сочетания заменяются автоцветом. */
export function colors(bgId: string, textId = "auto", prefix = "--b"): CSSProperties {
  const bg = BG[bgId] || "#FFFFFF";
  const wanted = TEXT[textId];
  const text = wanted && ratio(wanted, bg) >= 4.5 ? wanted : autoText(bg);
  const accent = ["#157F8C", "#106775", "#8FD6DE"].find((c) => ratio(c, bg) >= 3) || text;
  return {
    [`${prefix}-bg`]: bg,
    [`${prefix}-text`]: text,
    [`${prefix}-accent`]: accent,
    [`${prefix}-border`]: lum(bg) > 0.6 ? "#DFE7E5" : "transparent",
  } as CSSProperties;
}

export function AccentName({ name, accent }: { name: string; accent: number | null | undefined }) {
  const words = name.trim().split(/\s+/);
  if (accent == null || accent < 0 || accent >= words.length) return <>{name}</>;
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i ? " " : ""}
          {i === accent ? <em className="accent-word">{w}</em> : w}
        </span>
      ))}
    </>
  );
}

/** Опубликованное оформление. design = null — оформления нет или оно не загрузилось:
 * тогда страница показывается в обычном виде. */
export function usePlaceDesign(place: Place | undefined) {
  const [result, setResult] = useState<{ id: string; design: PlaceDesign | null }>();
  const id = place?.card_style ? place.id : null;
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    api<PlaceDesign>(`/places/${encodeURIComponent(id)}/design`, { signal: ctrl.signal })
      .then((design) => setResult({ id, design }))
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ id, design: null });
      });
    return () => ctrl.abort();
  }, [id]);
  if (!id) return { design: null, pending: false };
  if (result?.id !== id) return { design: null, pending: true };
  return { design: result.design, pending: false };
}

function Gallery({ design, name }: { design: PlaceDesign; name: string }) {
  const ordered = [
    ...design.photos.filter((p) => p.id === design.main_photo_id),
    ...design.photos.filter((p) => p.id !== design.main_photo_id),
  ];
  const [current, setCurrent] = useState(0);
  const shown = ordered[Math.min(current, ordered.length - 1)];
  if (!shown) return <div className="gal-empty">Фото пока нет</div>;
  return (
    <>
      <div className="gal-main">
        <img src={shown.url} alt={shown.alt || name} />
      </div>
      {ordered.length > 1 && (
        <div className="gal-thumbs" role="group" aria-label="Фотографии места">
          {ordered.map((p, i) => (
            <button
              key={p.id}
              aria-current={p.id === shown.id}
              aria-label={`Фото ${i + 1} из ${ordered.length}`}
              onClick={() => setCurrent(i)}
            >
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function DesignedPage({ place, design }: { place: Place; design: PlaceDesign }) {
  const body = (id: BlockId) => {
    switch (id) {
      case "title":
        return (
          <>
            <div className="cat">{place.categories.map((c) => c.name).join(" · ")}</div>
            <h1>
              <AccentName name={place.name} accent={design.title_accent} />
            </h1>
          </>
        );
      case "gallery":
        return <Gallery design={design} name={place.name} />;
      case "price":
        return (
          <>
            <p className="blk-label">Стоимость</p>
            <div className="amount">{price(place)}</div>
            {place.price_note && <p className="note">{place.price_note}</p>}
          </>
        );
      case "address":
        return (
          <>
            <p className="blk-label">Адрес</p>
            <p className="addr">{place.address || "Адрес уточняется"}</p>
          </>
        );
      case "description":
        return (
          <>
            <p className="blk-label">О месте</p>
            {place.description.split(/\n+/).filter(Boolean).map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </>
        );
    }
  };
  return (
    <div className="designed-grid">
      {design.page.order
        .filter((id) => !design.page.blocks[id]?.hidden)
        .filter((id) => id !== "gallery" || design.photos.length > 0)
        .map((id) => {
          const cfg = design.page.blocks[id];
          return (
            <section
              key={id}
              className={`dblk ${cfg.width}`}
              data-type={id}
              data-size={cfg.size}
              style={colors(cfg.bg, cfg.text)}
            >
              <div className="dblk-inner">{body(id)}</div>
            </section>
          );
        })}
    </div>
  );
}

/** Смайлики и стикеры поверх фото карточки в ленте свайпов. */
export function CardDecor({ style }: { style: CardStyle | null }) {
  if (!style?.items.length) return null;
  const stickers = style.items.filter((id) => id in STICKERS);
  const emoji = style.items.filter((id) => id in EMOJI);
  const rotations = ["-3deg", "2deg", "-1deg", "3deg"];
  return (
    <>
      {stickers.length > 0 && (
        <div className="card-stickers">
          {stickers.map((id, i) => (
            <span
              key={id}
              className={`card-sticker ${id === "editor" ? "editor" : ""}`}
              style={{ "--rot": rotations[i % 4] } as CSSProperties}
            >
              {STICKERS[id]}
            </span>
          ))}
        </div>
      )}
      {emoji.length > 0 && (
        <div className="card-emoji" role="img" aria-label={emoji.map((id) => EMOJI[id][1]).join(", ")}>
          {emoji.map((id) => (
            <span key={id} aria-hidden="true">
              {EMOJI[id][0]}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
