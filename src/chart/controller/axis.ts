import { deepMix, each, get, isBoolean, map, mix } from '@antv/util';
import { COMPONENT_TYPE, DIRECTION, LAYER } from '../../constant';
import { CircleAxis, CircleGrid, IGroup, LineAxis, LineGrid, Scale } from '../../dependents';
import {
  getAxisDirection,
  getAxisFactorByRegion,
  getAxisRegion,
  getAxisThemeCfg,
  getCircleAxisCenterRadius
} from '../../util/axis';
import { getAxisOption } from '../../util/axis';
import { getCircleGridItems, getGridThemeCfg, getLineGridItems, showGrid } from '../../util/grid';
import { omit } from '../../util/helper';
import { getName } from '../../util/scale';
import { AxisCfg, AxisOption, ComponentOption } from '../interface';
import View from '../view';
import { Controller } from './base';

type Option = Record<string, AxisOption> | boolean;


const DEFAULT_ANIMATE_CFG = {
  appear: null,
  update: {
    duration: 400,
    easing: 'easeQuadInOut',
  }, // 更新时发生变更的动画配置
  enter: {
    duration: 400,
    easing: 'easeQuadInOut',
  }, // 更新时新增元素的入场动画配置
  leave: {
    duration: 300,
    easing: 'easeQuadIn',
  }, // 更新时销毁动画配置
};

/**
 * G2 Axis controller, will:
 *  - create component
 *    - axis
 *    - grid
 *  - life circle
 */
export default class Axis extends Controller<Option> {
  /** the draw group of axis */
  private axisContainer: IGroup;
  private gridContainer: IGroup;
  /** 动画标识 */
  private animate: boolean;

  /** 使用 object 存储组件 */
  private cache = new Map<string, ComponentOption>();

  constructor(view: View) {
    super(view);

    // 先创建 gridContainer，将 grid 放到 axis 底层
    this.gridContainer = this.view.getLayer(LAYER.BG).addGroup();
    this.axisContainer = this.view.getLayer(LAYER.BG).addGroup();
  }

  public get name(): string {
    return 'axis';
  }

  public init() {}

  public render() {
    this.option = this.view.getOptions().axes;
    this.animate = false; // 初始化图表时，axis 不参与动画

    this.createXAxes();
    this.createYAxes();
  }

  /**
   * 更新组件布局，位置大小
   */
  public layout() {
    const coordinate = this.view.getCoordinate();

    each(this.getComponents(), (co: ComponentOption) => {
      const { component, direction, type, extra } = co;
      const { dim, scale } = extra;

      let updated;

      if (type === COMPONENT_TYPE.AXIS) {
        if (coordinate.isPolar) {
          if (dim === 'x') {
            updated = getCircleAxisCenterRadius(coordinate);
          } else if (dim === 'y') {
            updated = getAxisRegion(coordinate, direction);
          }
        } else {
          updated = getAxisRegion(coordinate, direction);
        }
      } else if (type === COMPONENT_TYPE.GRID) {
        if (coordinate.isPolar) {
          updated = {
            items: getCircleGridItems(coordinate, this.view.getXScale(), scale, dim),
            // coordinate 更新之后，center 也变化了
            center: this.view.getCoordinate().getCenter(),
          };
        } else {
          updated = { items: getLineGridItems(coordinate, scale, dim) };
        }
      }

      component.update(updated);
    });
  }

  /**
   * 更新 axis 组件
   */
  public update() {
    this.option = this.view.getOptions().axes;
    this.animate = true; // 发生更新时，开启动画，但是最后是否进行动画，还是以用户配置为准
    const updatedCache = new Map<string, ComponentOption>();

    this.updateXAxes(updatedCache);
    this.updateYAxes(updatedCache);

    // 处理完成之后，销毁删除的
    // 不在处理中的
    const newCache = new Map<string, ComponentOption>();

    this.cache.forEach((co: ComponentOption, key: string) => {
      if (updatedCache.has(key)) {
        newCache.set(key, co);
      } else {
        // 不存在，则是所有需要被销毁的组件
        co.component.destroy();
      }
    });

    // 更新缓存
    this.cache = newCache;
  }

  public clear() {
    super.clear();

    this.cache.clear();

    this.gridContainer.clear();
    this.axisContainer.clear();
  }

  public destroy() {
    super.destroy();

    this.gridContainer.remove(true);
    this.axisContainer.remove(true);
  }

  /**
   * @override
   */
  public getComponents(): ComponentOption[] {
    const co = [];

    this.cache.forEach((value: ComponentOption) => {
      co.push(value);
    });

    return co;
  }

  /**
   * 更新 x axis
   * @param updatedCache
   */
  private updateXAxes(updatedCache: Map<string, ComponentOption>) {
    // x axis
    const scale = this.view.getXScale();
    // @ts-ignore
    if (!scale || scale.isIdentity) {
      return;
    }

    const { field } = scale;
    const xAxisOption = getAxisOption(this.option, scale.field);
    if (xAxisOption === false) {
      return;
    }

    const coordinate = this.view.getCoordinate();

    const axisId = this.getId('axis', field);
    const gridId = this.getId('grid', field);

    const direction = getAxisDirection(xAxisOption, DIRECTION.BOTTOM);
    const layer = LAYER.BG;
    const dim = 'x';

    if (coordinate.isRect) {
      // 1. do axis update
      let axis = this.cache.get(axisId);
      // 存在则更新
      if (axis) {
        const cfg = this.getLineAxisCfg(scale, xAxisOption, direction);
        omit(cfg, ['container']);
        axis.component.update(cfg);
        updatedCache.set(axisId, axis);
      } else {
        // 不存在，则创建
        axis = this.createLineAxis(scale, xAxisOption, layer, direction, dim);
        this.cache.set(axisId, axis);
        updatedCache.set(axisId, axis);
      }

      // 2. do grid update
      let grid = this.cache.get(gridId);
      // 存在则更新
      if (grid) {
        const cfg = this.getLineGridCfg(scale, xAxisOption, direction, dim);
        omit(cfg, ['container']);
        grid.component.update(cfg);
        updatedCache.set(gridId, grid);
      } else {
        // 不存在则创建
        grid = this.createLineGrid(scale, xAxisOption, layer, direction, dim);
        if (grid) {
          this.cache.set(gridId, grid);
          updatedCache.set(gridId, grid);
        }
      }
    } else if (coordinate.isPolar && !coordinate.isTransposed) {
      // 1. do axis update
      let axis = this.cache.get(axisId);
      // 存在则更新
      if (axis) {
        const cfg = this.getCircleAxisCfg(scale, xAxisOption, direction);
        omit(cfg, ['container']);
        axis.component.update(cfg);
        updatedCache.set(axisId, axis);
      } else {
        // 不存在，则创建
        axis = this.createCircleAxis(scale, xAxisOption, layer, direction, dim);
        this.cache.set(axisId, axis);
        updatedCache.set(axisId, axis);
      }

      // 2. do grid update
      let grid = this.cache.get(gridId);
      // 存在则更新
      if (grid) {
        const cfg = this.getCircleGridCfg(scale, xAxisOption, direction, dim);
        omit(cfg, ['container']);
        grid.component.update(cfg);
        updatedCache.set(gridId, grid);
      } else {
        // 不存在则创建
        grid = this.createCircleLineGrid(scale, xAxisOption, layer, direction, dim);
        if (grid) {
          this.cache.set(gridId, grid);
          updatedCache.set(gridId, grid);
        }
      }
    } else {
      // helix and other, do not draw axis
    }
  }

  private updateYAxes(updatedCache: Map<string, ComponentOption>) {
    // y axes
    const yScales = this.view.getYScales();

    each(yScales, (scale: Scale, idx: number) => {
      // @ts-ignore
      if (!scale || scale.isIdentity) {
        return;
      }
      const { field } = scale;
      const yAxisOption = getAxisOption(this.option, field);

      if (yAxisOption !== false) {
        const layer = LAYER.BG;
        const dim = 'y';
        const axisId = this.getId('axis', field);
        const gridId = this.getId('grid', field);

        const coordinate = this.view.getCoordinate();

        if (coordinate.isRect) {
          const direction = getAxisDirection(yAxisOption, idx === 0 ? DIRECTION.LEFT : DIRECTION.RIGHT);

          // 1. do axis update
          let axis = this.cache.get(axisId);
          // 存在则更新
          if (axis) {
            const cfg = this.getLineAxisCfg(scale, yAxisOption, direction);
            omit(cfg, ['container']);
            axis.component.update(cfg);
            updatedCache.set(axisId, axis);
          } else {
            // 不存在，则创建
            axis = this.createLineAxis(scale, yAxisOption, layer, direction, dim);
            this.cache.set(axisId, axis);
            updatedCache.set(axisId, axis);
          }

          // 2. do grid update
          let grid = this.cache.get(gridId);
          // 存在则更新
          if (grid) {
            const cfg = this.getLineGridCfg(scale, yAxisOption, direction, dim);
            omit(cfg, ['container']);
            grid.component.update(cfg);
            updatedCache.set(gridId, grid);
          } else {
            // 不存在则创建
            grid = this.createLineGrid(scale, yAxisOption, layer, direction, dim);
            if (grid) {
              this.cache.set(gridId, grid);
              updatedCache.set(gridId, grid);
            }
          }
        } else if (coordinate.isPolar && !coordinate.isTransposed) {
          // 1. do axis update
          let axis = this.cache.get(axisId);
          // 存在则更新
          if (axis) {
            // @ts-ignore
            const cfg = this.getLineAxisCfg(scale, yAxisOption, 'radius');
            omit(cfg, ['container']);
            axis.component.update(cfg);
            updatedCache.set(axisId, axis);
          } else {
            // 不存在，则创建
            // @ts-ignore
            axis = this.createLineAxis(scale, yAxisOption, layer, 'radius', dim);
            this.cache.set(axisId, axis);
            updatedCache.set(axisId, axis);
          }

          // 2. do grid update
          let grid = this.cache.get(gridId);
          // 存在则更新
          if (grid) {
            // @ts-ignore
            const cfg = this.getCircleGridCfg(scale, yAxisOption, 'radius', dim);
            omit(cfg, ['container']);
            grid.component.update(cfg);
            updatedCache.set(gridId, grid);
          } else {
            // 不存在则创建
            // @ts-ignore
            grid = this.createCircleGrid(scale, yAxisOption, layer, 'radius', dim);
            if (grid) {
              this.cache.set(gridId, grid);
              updatedCache.set(gridId, grid);
            }
          }
        } else {
          // helix and other, do not draw axis
        }
      }
    });
  }

  /**
   * 创建 x axis 组件
   */
  private createXAxes() {
    // x axis
    const scale = this.view.getXScale();

    // @ts-ignore
    if (!scale || scale.isIdentity) {
      return;
    }

    const xAxisOption = getAxisOption(this.option, scale.field);
    if (xAxisOption !== false) {
      const direction = getAxisDirection(xAxisOption, DIRECTION.BOTTOM);
      const layer = LAYER.BG;
      const dim = 'x';

      const coordinate = this.view.getCoordinate();

      const axisId = this.getId('axis', scale.field);
      const gridId = this.getId('grid', scale.field);

      if (coordinate.isRect) {
        // axis
        const axis = this.createLineAxis(scale, xAxisOption, layer, direction, dim);
        this.cache.set(axisId, axis);

        // grid
        const grid = this.createLineGrid(scale, xAxisOption, layer, direction, dim);
        if (grid) {
          this.cache.set(gridId, grid);
        }
      } else if (coordinate.isPolar && !coordinate.isTransposed) {
        // axis
        const axis = this.createCircleAxis(scale, xAxisOption, layer, direction, dim);
        this.cache.set(axisId, axis);

        // grid
        const grid = this.createCircleLineGrid(scale, xAxisOption, layer, direction, dim);
        if (grid) {
          this.cache.set(gridId, grid);
        }
      } else {
        // helix and other, do not draw axis
      }
    }
  }

  /**
   * create y axis
   */
  private createYAxes() {
    // y axes
    const yScales = this.view.getYScales();

    each(yScales, (scale: Scale, idx: number) => {
      // @ts-ignore
      if (!scale || scale.isIdentity) {
        return;
      }
      const { field } = scale;
      const yAxisOption = getAxisOption(this.option, field);

      if (yAxisOption !== false) {
        const layer = LAYER.BG;
        const dim = 'y';
        const axisId = this.getId('axis', field);
        const gridId = this.getId('grid', field);

        const coordinate = this.view.getCoordinate();

        if (coordinate.isRect) {
          const direction = getAxisDirection(yAxisOption, idx === 0 ? DIRECTION.LEFT : DIRECTION.RIGHT);
          // axis
          const axis = this.createLineAxis(scale, yAxisOption, layer, direction, dim);
          this.cache.set(axisId, axis);

          // grid
          const grid = this.createLineGrid(scale, yAxisOption, layer, direction, dim);
          if (grid) {
            this.cache.set(gridId, grid);
          }
        } else if (coordinate.isPolar && !coordinate.isTransposed) {
          // axis
          // @ts-ignore
          const axis = this.createLineAxis(scale, yAxisOption, layer, 'radius', dim);
          this.cache.set(this.getId('axis', scale.field), axis);

          // grid
          // @ts-ignore
          const grid = this.createCircleGrid(scale, yAxisOption, layer, 'radius', dim);
          if (grid) {
            this.cache.set(gridId, grid);
          }
        } else {
          // helix and other, do not draw axis
        }
      }
    });
  }

  /**
   * 创建 line axis
   * @param scale
   * @param option
   * @param layer
   * @param direction
   * @param dim
   */
  private createLineAxis(
    scale: Scale,
    option: AxisCfg,
    layer: LAYER,
    direction: DIRECTION,
    dim: string
  ): ComponentOption {
    // axis
    const axis = {
      component: new LineAxis(this.getLineAxisCfg(scale, option, direction)),
      layer,
      // @ts-ignore
      direction: direction === 'radius' ? DIRECTION.NONE : direction,
      type: COMPONENT_TYPE.AXIS,
      extra: { dim, scale },
    };
    axis.component.set('field', scale.field);
    axis.component.render();

    return axis;
  }

  private createLineGrid(
    scale: Scale,
    option: AxisCfg,
    layer: LAYER,
    direction: DIRECTION,
    dim: string
  ): ComponentOption {
    const cfg = this.getLineGridCfg(scale, option, direction, dim);
    if (cfg) {
      const grid = {
        component: new LineGrid(cfg),
        layer,
        direction: DIRECTION.NONE,
        type: COMPONENT_TYPE.GRID,
        extra: { dim, scale },
      };
      grid.component.render();

      return grid;
    }
  }

  private createCircleAxis(
    scale: Scale,
    option: AxisCfg,
    layer: LAYER,
    direction: DIRECTION,
    dim: string
  ): ComponentOption {
    const axis = {
      component: new CircleAxis(this.getCircleAxisCfg(scale, option, direction)),
      layer,
      direction,
      type: COMPONENT_TYPE.AXIS,
      extra: { dim, scale },
    };
    axis.component.set('field', scale.field);

    axis.component.render();

    return axis;
  }

  private createCircleGrid(
    scale: Scale,
    option: AxisCfg,
    layer: LAYER,
    direction: DIRECTION,
    dim: string
  ): ComponentOption {
    const cfg = this.getCircleGridCfg(scale, option, direction, dim);
    if (cfg) {
      const grid = {
        component: new CircleGrid(cfg),
        layer,
        direction: DIRECTION.NONE,
        type: COMPONENT_TYPE.GRID,
        extra: { dim: 'y', scale },
      };

      grid.component.render();
      return grid;
    }
  }

  private createCircleLineGrid(
    scale: Scale,
    option: AxisCfg,
    layer: LAYER,
    direction: DIRECTION,
    dim: string
  ): ComponentOption {
    const cfg = this.getCircleGridCfg(scale, option, direction, dim);
    if (cfg) {
      const grid = {
        component: new LineGrid(cfg),
        layer,
        direction: DIRECTION.NONE,
        type: COMPONENT_TYPE.GRID,
        extra: { dim: 'x', scale },
      };

      grid.component.render();
      return grid;
    }
  }

  /**
   * generate line axis cfg
   * @param scale
   * @param axisOption
   * @param direction
   * @return line axis cfg
   */
  private getLineAxisCfg(scale: Scale, axisOption: AxisCfg, direction: DIRECTION): object {
    const container = this.axisContainer;
    const coordinate = this.view.getCoordinate();

    const region = getAxisRegion(coordinate, direction);
    const titleText = getName(scale);

    const baseAxisCfg = {
      container,
      ...region,
      ticks: map(scale.getTicks(), (tick) => ({ id: `${tick.tickValue}`, name: tick.text, value: tick.value })),
      title: {
        text: titleText,
      },
      verticalFactor: coordinate.isPolar
        ? getAxisFactorByRegion(region, coordinate.getCenter()) * -1
        : getAxisFactorByRegion(region, coordinate.getCenter()),
    };

    const axisThemeCfg = getAxisThemeCfg(this.view.getTheme(), direction);
    // the cfg order should be ensure
    const optionWithTitle = get(axisOption, ['title'])
      ? deepMix({}, { title: { style: { text: titleText } } }, axisOption)
      : axisOption;

    const cfg = deepMix({}, baseAxisCfg, axisThemeCfg, optionWithTitle);
    return mix(cfg, this.getAnimateCfg(cfg));
  }

  /**
   * generate line grid cfg
   * @param scale
   * @param axisOption
   * @param direction
   * @param dim
   * @return line grid cfg
   */
  private getLineGridCfg(scale: Scale, axisOption: AxisCfg, direction: DIRECTION, dim: string): object {
    if (!showGrid(getAxisThemeCfg(this.view.getTheme(), direction), axisOption)) {
      return undefined;
    }

    const container = this.gridContainer;

    const baseGridCfg = {
      container,
      items: getLineGridItems(this.view.getCoordinate(), scale, dim),
    };

    const gridThemeCfg = getGridThemeCfg(this.view.getTheme(), direction);
    // the cfg order should be ensure
    // grid 动画以 axis 为准
    return deepMix({}, baseGridCfg, gridThemeCfg, get(axisOption, 'grid', {}), this.getAnimateCfg(axisOption));
  }

  /**
   * generate circle axis cfg
   * @param scale
   * @param axisOption
   * @param direction
   * @return circle axis cfg
   */
  private getCircleAxisCfg(scale: Scale, axisOption: AxisCfg, direction: DIRECTION): object {
    const container = this.axisContainer;

    const ticks = map(scale.getTicks(), (tick) => ({ id: `${tick.tickValue}`, name: tick.text, value: tick.value }));
    const coordinate = this.view.getCoordinate();
    if (!scale.isCategory && Math.abs(coordinate.endAngle - coordinate.startAngle) === Math.PI * 2) {
      // x 轴对应的值如果是非 cat 类型，在整圆的情况下坐标轴第一个和最后一个文本会重叠，默认只展示第一个文本
      ticks.pop();
    }

    const titleText = getName(scale);

    const baseAxisCfg = {
      container,
      ...getCircleAxisCenterRadius(this.view.getCoordinate()),
      ticks,
      title: {
        text: getName(scale),
      },
      verticalFactor: 1,
    };

    const axisThemeCfg = getAxisThemeCfg(this.view.getTheme(), 'circle');

    // the cfg order should be ensure
    const optionWithTitle = get(axisOption, ['title'])
      ? deepMix({}, { title: { style: { text: titleText } } }, axisOption)
      : axisOption;

    const cfg = deepMix({}, baseAxisCfg, axisThemeCfg, optionWithTitle);

    return mix(cfg, this.getAnimateCfg(cfg));
  }

  /**
   * generate circle grid cfg
   * @param scale
   * @param axisOption
   * @param direction
   * @param dim
   * @return circle grid cfg
   */
  private getCircleGridCfg(scale: Scale, axisOption: AxisCfg, direction: DIRECTION, dim: string): object {
    if (!showGrid(getAxisThemeCfg(this.view.getTheme(), direction), axisOption)) {
      return undefined;
    }

    const container = this.gridContainer;

    const baseGridCfg = {
      container,
      items: getCircleGridItems(this.view.getCoordinate(), this.view.getXScale(), scale, dim),
      center: this.view.getCoordinate().getCenter(),
    };

    // @ts-ignore
    const gridThemeCfg = getGridThemeCfg(this.view.getTheme(), 'circle');

    // the cfg order should be ensure
    // grid 动画以 axis 为准
    return deepMix({}, baseGridCfg, gridThemeCfg, get(axisOption, 'grid', {}), this.getAnimateCfg(axisOption));
  }

  private getId(name: string, key: string): string {
    return `${name}-${key}`;
  }

  private getAnimateCfg(cfg: object) {
    return {
      animate: this.view.getOptions().animate && this.animate && get(cfg, 'animate'), // 如果 view 关闭动画，则不执行动画
      animateOption: deepMix({}, DEFAULT_ANIMATE_CFG, get(cfg, 'animateOption', {})),
    };
  }
}