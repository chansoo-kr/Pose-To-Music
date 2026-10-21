import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./style.css";
import { App } from "./app";
import { initLibrary } from "./data/library";
import { TitleScene } from "./scenes/title";

initLibrary();
const app = new App(document.querySelector<HTMLDivElement>("#app")!);
app.go(new TitleScene(app));
