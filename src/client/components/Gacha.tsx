import { useRef, useState } from "react";
import { DEFAULT_QUERY, type SearchQuery } from "../../shared/query.ts";
import type { GameSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { CAPSULE, COIN, MACHINE, MACHINE_TURN, Pixel, SPARK } from "../pixel.tsx";
import { MiniCard } from "./MiniCard.tsx";

/** What the machine is filled with: games most people who played them liked. */
const POOL: SearchQuery = { ...DEFAULT_QUERY, sort: "rating", minPct: 90, minReviews: 500, hide: ["porn"] };
/** Long enough to see the machine rattle. */
const TURN_MS = 900;

export function Gacha({ currency, onOpen }: { currency: string; onOpen: (id: string) => void }) {
  const [prize, setPrize] = useState<GameSummary | null>(null);
  const [turning, setTurning] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = useRef(0);

  const turn = async () => {
    if (turning) return;
    setTurning(true);
    setFailed(false);
    try {
      const wait = new Promise((done) => setTimeout(done, TURN_MS));
      if (!total.current) total.current = (await api.search(POOL, { pageSize: 1 })).total;
      const page = 1 + Math.floor(Math.random() * total.current);
      const found = await api.search({ ...POOL, page }, { pageSize: 1 });
      await wait;
      setPrize(found.results[0] ?? null);
    } catch {
      setFailed(true);
    } finally {
      setTurning(false);
    }
  };

  return (
    <div className={`gacha ${turning ? "turning" : ""}`}>
      <div className="gacha-bubble">
        {prize ? (
          <>
            <p className="gacha-says">It gave you this one</p>
            <MiniCard key={prize.id} game={prize} currency={currency} onOpen={() => onOpen(prize.id)} />
          </>
        ) : (
          <p className="gacha-says">
            Not sure what to play? Turn the knob and get a game that at least nine players in ten liked.
          </p>
        )}
        {failed && <p className="error small">The machine jammed. Try again.</p>}
        <button className="primary" onClick={turn} disabled={turning}>
          {turning ? "Rattling…" : prize ? "Turn again" : "Turn the knob"}
        </button>
      </div>
      <div className="gacha-stage">
        <Pixel art={MACHINE} alt={MACHINE_TURN} size={8} className="gacha-machine" />
        {prize && !turning && <Pixel key={prize.id} art={CAPSULE} size={5} className="doodle dropped" />}
        <Pixel art={SPARK} size={5} className="doodle spark-a" />
        <Pixel art={SPARK} size={3} className="doodle spark-b" />
        <Pixel art={COIN} size={5} className="doodle coin coin-a" />
        <Pixel art={COIN} size={5} className="doodle coin coin-b" />
      </div>
    </div>
  );
}
