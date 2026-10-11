import type { TripDocument } from '../models';
import { usePhoto } from '../hooks/usePhoto';
export function Cover({
  theme = 'mountain',
  doc,
  hero = false,
}: {
  theme?: string;
  doc?: TripDocument;
  hero?: boolean;
}) {
  const image = usePhoto(doc?.photos.find((p) => p.id === doc.trip.coverPhotoId));
  if (image) return <img src={image} className="cover-image" alt={`${doc?.trip.title}的封面`} />;
  const colors =
    theme === 'coast'
      ? ['#c7d9d9', '#93b2b3', '#6e9394', '#eee7d4']
      : theme === 'city'
        ? ['#dddbc9', '#b3bba4', '#7d9581', '#385d51']
        : theme === 'forest'
          ? ['#d3dbcb', '#acbda3', '#76937b', '#3c6556']
          : ['#e1e5db', '#bdc9b8', '#8ea58f', '#517461'];
  return (
    <svg
      className={`cover-illustration ${hero ? 'hero-illustration' : ''}`}
      viewBox="0 0 900 480"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="原创山水旅行插画"
    >
      <defs>
        <linearGradient id={`sky-${theme}-${hero}`} x2="0" y2="1">
          <stop stopColor={colors[0]} />
          <stop offset="1" stopColor="#f2f0e5" />
        </linearGradient>
        <pattern id={`grain-${theme}-${hero}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="2" r=".6" fill="#fff" opacity=".22" />
        </pattern>
      </defs>
      <path fill={`url(#sky-${theme}-${hero})`} d="M0 0h900v480H0z" />
      <circle cx="674" cy="126" r="49" fill="#e2c89b" />
      <path d="M0 300L140 145 230 235 415 95 590 285 690 208 900 320V480H0Z" fill={colors[1]} />
      <path d="M0 360L145 282 273 325 440 219 550 310 720 255 900 345V480H0Z" fill={colors[2]} />
      <path d="M0 401Q170 300 350 384T650 360T900 400V480H0Z" fill={colors[3]} />
      {theme === 'coast' ? (
        <>
          <path d="M0 390Q280 360 450 418T900 400V480H0Z" fill="#c8d9d1" />
          <path
            d="M250 405q150 40 380 15M350 448q150 20 320 0"
            fill="none"
            stroke="#f3f0e2"
            strokeWidth="3"
          />
        </>
      ) : (
        <path
          d="M504 480Q620 430 530 397T569 349"
          fill="none"
          stroke="#e8e3cf"
          strokeWidth="13"
          opacity=".85"
        />
      )}
      {theme === 'city' && (
        <g fill="#f1e8d4">
          <path d="M165 350v-62h45v62zm-14-62 37-28 37 28zM242 368v-85h34v85zm-14-85 31-25 31 25z" />
          <path d="M172 350h9v-23h12v23m55 18h8v-23h12v23" fill="#556d59" />
        </g>
      )}
      {theme === 'forest' && (
        <g fill="#315847">
          {[90, 160, 710, 780, 840].map((x, i) => (
            <path key={x} d={`M${x} ${350 + i * 8}l-28 70h56zM${x - 3} ${410 + i * 8}h6v35h-6z`} />
          ))}
        </g>
      )}
      <path fill={`url(#grain-${theme}-${hero})`} d="M0 0h900v480H0z" />
      {hero && (
        <g transform="translate(105 77)" fill="none" stroke="#496859" opacity=".6">
          <circle r="35" />
          <circle r="30" strokeDasharray="1 7" />
          <path d="m0-23 7 23-7 23-7-23z" />
          <path d="M-23 0h46" />
          <text
            y="-45"
            textAnchor="middle"
            fill="#496859"
            stroke="none"
            fontSize="12"
            letterSpacing="3"
          >
            N
          </text>
        </g>
      )}
    </svg>
  );
}
