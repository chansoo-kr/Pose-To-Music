import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource-variable/unbounded";
import "./style.css";
import { App } from "./app";
import { TitleScene } from "./scenes/title";

const app = new App(document.querySelector<HTMLDivElement>("#app")!);
app.go(new TitleScene(app));
