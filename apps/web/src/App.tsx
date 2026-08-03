import { FormEvent, useState } from "react";
import {
  brand,
  identityLockNote,
  landingHero,
  philosophyClosing,
  philosophyLead,
  philosophySections,
} from "@forever/philosophy";

type WaitlistState = "idle" | "loading" | "done" | "error";

async function submitWaitlist(email: string): Promise<void> {
  const endpoint = import.meta.env.VITE_WAITLIST_ENDPOINT as string | undefined;
  const formspree = import.meta.env.VITE_FORMSPREE_ID as string | undefined;

  if (endpoint) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("waitlist_failed");
    return;
  }

  if (formspree) {
    const res = await fetch(`https://formspree.io/f/${formspree}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, _subject: "Forever early access" }),
    });
    if (!res.ok) throw new Error("waitlist_failed");
    return;
  }

  // Local / demo fallback — persist on device until an endpoint is configured.
  const key = "forever.waitlist";
  const prev = JSON.parse(localStorage.getItem(key) || "[]") as string[];
  if (!prev.includes(email)) {
    localStorage.setItem(key, JSON.stringify([...prev, email]));
  }
}

function WaitlistForm({ id }: { id?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setState("error");
      setMessage("Vui lòng nhập email hợp lệ.");
      return;
    }
    setState("loading");
    setMessage("");
    try {
      await submitWaitlist(trimmed);
      setState("done");
      setMessage("Cảm ơn bạn. Chúng tôi sẽ liên hệ khi mái nhà sẵn sàng đón gia đình.");
      setEmail("");
    } catch {
      setState("error");
      setMessage("Không gửi được lúc này. Thử lại sau, hoặc viết thư tới " + brand.contactEmail + ".");
    }
  }

  return (
    <form id={id} className="waitlist" onSubmit={onSubmit} noValidate>
      <label className="sr-only" htmlFor={`${id ?? "waitlist"}-email`}>
        Email
      </label>
      <input
        id={`${id ?? "waitlist"}-email`}
        type="email"
        name="email"
        autoComplete="email"
        placeholder="email của bạn"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state !== "idle" && state !== "loading") setState("idle");
        }}
        disabled={state === "loading"}
        required
      />
      <button type="submit" disabled={state === "loading"}>
        {state === "loading" ? "Đang gửi…" : landingHero.ctaPrimary}
      </button>
      {message ? (
        <p className={`waitlist-msg ${state === "error" ? "is-error" : "is-ok"}`} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}

export function App() {
  const vault = philosophySections[0];
  const identity = philosophySections[1];
  const bridge = philosophySections[2];
  const heal = philosophySections[3];
  const vow = philosophySections[4];

  return (
    <>
      <a className="skip" href="#triet-ly">
        Tới triết lý
      </a>

      <header className="nav">
        <a className="nav-brand" href="#top" aria-label={brand.name}>
          <img
            src="/brand/lockup-horizontal-on-cream.svg"
            alt={brand.name}
            width={140}
            height={36}
          />
        </a>
        <nav className="nav-links" aria-label="Chính">
          <a href="#triet-ly">Triết lý</a>
          <a href="#early-access">Early access</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-headline">
          <div className="hero-media" aria-hidden="true">
            <img src="/hero.png" alt="" className="hero-photo" />
            <div className="hero-scrim" />
          </div>
          <div className="hero-content">
            <img
              className="hero-lockup reveal"
              src="/brand/lockup-stacked-on-dark.svg"
              alt={brand.name}
              width={200}
              height={160}
            />
            <h1 id="hero-headline" className="reveal delay-1">
              {landingHero.headline}
            </h1>
            <p className="hero-supporting reveal delay-2">{landingHero.supporting}</p>
            <div className="hero-cta reveal delay-3">
              <a className="btn-primary" href="#early-access">
                {landingHero.ctaPrimary}
              </a>
              <a className="btn-text" href="#triet-ly">
                {landingHero.ctaSecondary}
              </a>
            </div>
          </div>
        </section>

        <section className="section section-lead" id="triet-ly" aria-labelledby="why-title">
          <p className="eyebrow">Vì sao Forever tồn tại</p>
          <h2 id="why-title" className="sr-only">
            Vì sao Forever tồn tại
          </h2>
          <p className="lead reveal">{philosophyLead}</p>
        </section>

        <section className="section section-alt" aria-labelledby="vault-title">
          <div className="section-inner with-mark">
            <img className="section-mark" src="/brand/mark.svg" alt="" width={72} height={72} />
            <div>
              <h2 id="vault-title">{vault.title}</h2>
              {vault.paragraphs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="identity-title">
          <div className="section-inner">
            <h2 id="identity-title">{identity.title}</h2>
            {identity.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
            <p className="identity-note">{identityLockNote}</p>
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="bridge-title">
          <div className="section-inner">
            <h2 id="bridge-title">{bridge.title}</h2>
            {bridge.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
            {bridge.quote ? (
              <blockquote className="quote reveal-quote">
                <p>{bridge.quote}</p>
              </blockquote>
            ) : null}
          </div>
        </section>

        <section className="section" aria-labelledby="heal-title">
          <div className="section-inner">
            <h2 id="heal-title">{heal.title}</h2>
            {heal.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </div>
        </section>

        <section className="section section-alt" id="cam-ket" aria-labelledby="vow-title">
          <div className="section-inner">
            <h2 id="vow-title">{vow.title}</h2>
            {vow.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </div>
        </section>

        <section className="section section-close" aria-labelledby="close-title">
          <h2 id="close-title" className="sr-only">
            Mái nhà tinh thần
          </h2>
          <p className="closing">{philosophyClosing}</p>
        </section>

        <section className="section section-cta" id="early-access" aria-labelledby="cta-title">
          <div className="section-inner narrow">
            <h2 id="cta-title">Giữ chỗ cho gia đình bạn</h2>
            <p className="cta-sub">
              Forever đang mở dần cho những mái nhà sẵn sàng giữ ký ức với sự tôn nghiêm.
              Để lại email — chúng tôi sẽ mời khi đến lượt.
            </p>
            <WaitlistForm id="early-access-form" />
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>{brand.privacyLine}</p>
        <p>
          <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>
          {" · "}
          <span>© {new Date().getFullYear()} {brand.name}</span>
        </p>
      </footer>
    </>
  );
}
