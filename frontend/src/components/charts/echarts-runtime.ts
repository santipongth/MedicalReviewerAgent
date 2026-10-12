// The echarts runtime, registered once. Imported only through `loadEcharts()` in echart.tsx, so the web app
// fetches it lazily when a chart first mounts instead of on every /r/[id] page load.
import { BarChart, CustomChart, GraphChart, LineChart, ScatterChart, TreeChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, CustomChart, GraphChart, LineChart, ScatterChart, TreeChart, AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

export const init = echarts.init;
