// Page header of a tool screen: 40px Space Grotesk title, optional plain
// sentence under it, and actions on the right. Same look as Home.

import type { ReactNode } from "react";
import st from "./PageHead.module.css";

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className={st.head}>
      <div className={st.text}>
        <h1 className={st.title}>{title}</h1>
        {sub ? <p className={st.sub}>{sub}</p> : null}
      </div>
      {actions ? <div className={st.actions}>{actions}</div> : null}
    </header>
  );
}
