/**
 * Logo LC Agência de Comunicação.
 * Se existir /public/lc-logo.png, usa a imagem.
 * Caso contrário, reproduz o logo em CSS (LC + balões de fala magenta/berry).
 */
import { useEffect, useState } from 'react';

export default function LCLogo({ variant = 'light', size = 'md', showSub = true }) {
  const [hasImg, setHasImg] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasImg(true);
    img.onerror = () => setHasImg(false);
    img.src = '/lc-logo.png';
  }, []);

  if (hasImg) {
    return (
      <img
        src="/lc-logo.png"
        alt="LC Agência de Comunicação"
        style={{
          height: size === 'sm' ? 28 : size === 'lg' ? 56 : 40,
          display: 'block',
          filter: variant === 'on-dark' ? 'brightness(0) invert(1)' : 'none',
        }}
      />
    );
  }

  // Fallback CSS: wordmark "LC" com balões
  return (
    <div className={`lc-logo ${variant === 'on-dark' ? 'on-dark' : ''}`}
         style={{ fontSize: size === 'sm' ? 22 : size === 'lg' ? 40 : 30 }}>
      <span className="wordmark">LC</span>
      <span className="bubbles" />
      {showSub && (
        <span className="sub">agência de<br />comunicação</span>
      )}
    </div>
  );
}
