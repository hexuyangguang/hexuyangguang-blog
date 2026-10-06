很多人学 STM32 卡在第一步：环境搭不起来。装完 Keil 发现没有芯片包，装了 CubeMX 生成的工程又编译报错，好不容易下载进去板子没反应。

这篇文章把整条链路走一遍，从工具选型到点亮 LED，每一步说清楚**为什么这么做**，以及出问题时该查哪里。

## 一、工具链怎么选

STM32 开发有三套主流方案，先明确差异再动手：

| 方案 | 上手难度 | 代码可移植性 | 适合场景 |
|---|---|---|---|
| STM32CubeMX + HAL 库 | 低 | 高（跨 F0/F1/F4/H7） | 新手入门、产品开发 |
| 标准外设库（SPL） | 中 | 低（各系列不通用） | 维护老项目 |
| 寄存器 / LL 库 | 高 | 低 | 学习原理、极限优化 |

**建议直接上 HAL**。它被诟病"效率低、代码臃肿"，但在 F1 以上的芯片上，多出来的开销通常可以接受，而省下的时间非常可观。真到了性能瓶颈，再针对具体外设换成 LL 库或直接操作寄存器。

需要装的软件：

1. **Keil MDK-ARM**（或 STM32CubeIDE）—— 编译器 + 调试器
2. **STM32CubeMX** —— 图形化配置引脚、时钟、外设，生成初始化代码
3. **对应系列的 Device Family Pack（DFP）** —— Keil 的芯片支持包
4. **ST-Link 驱动** —— 下载器驱动

CubeIDE 是 ST 官方的免费整合环境，把 CubeMX 和编译调试都包进去了，不想折腾授权的话可以直接用它，下面步骤基本一致。

## 二、CubeMX 配置：五个必看的地方

新建工程选好芯片型号后，左侧这一列是需要重点关注的：

### 2.1 RCC：时钟源

`System Core → RCC`：

- **High Speed Clock (HSE)** 选 `Crystal/Ceramic Resonator`

这一步是**新手最常漏的**。不配的话芯片会用内部 RC 振荡器（HSI，精度差），你后面在时钟树里怎么调都到不了 72MHz。

### 2.2 时钟树：算清楚每一级

以 STM32F103C8T6 跑 72MHz 为例：

```
HSE 8MHz ──/1──> PLLSRC
                  │
               ×9 (PLLMUL)
                  ↓
              72MHz (PLLCLK)
                  │
              SW = PLLCLK
                  ↓
              SYSCLK 72MHz
              ├── AHB  /1  → HCLK  72MHz
              └── APB1 /2  → PCLK1 36MHz  (上限 36MHz)
                  APB2 /1  → PCLK2 72MHz  (上限 72MHz)
```

要点：

- **APB1 最大 36MHz，APB2 最大 72MHz**。超了不会立刻报错，但外设行为会变得莫名其妙。
- 定时器时钟有额外倍频规则：如果 APB 分频系数不是 1，定时器时钟 = APB 时钟 × 2。所以 APB1 上的定时器实际跑 72MHz，**算波特率和定时周期时别算错**。

配置完看 CubeMX 右下角的 Summary，确认每个时钟都在范围内。

### 2.3 GPIO：点灯引脚

在芯片图上点 PC13（大多数最小系统板的板载 LED），选 `GPIO_Output`。然后在 `System Core → GPIO` 里设置：

- **GPIO output level**：Low（多数板子 LED 是低电平点亮，具体看原理图）
- **GPIO mode**：Output Push Pull
- **Pull-up/Pull-down**：No pull-up and no pull-down
- **Maximum output speed**：Low（点灯不需要高速，降低 EMI）
- **User Label**：填 `LED`，生成代码时会变成宏定义，比满屏 `GPIO_PIN_13` 可读得多

### 2.4 SYS：调试接口

`System Core → SYS → Debug` 选 `Serial Wire`。

**这步千万别忘**。默认的 `No Debug` 会在生成代码时把 SWD 引脚复用掉，第一次下载之后芯片就再也连不上了，只能用 BOOT0 拉高的方式救回来。

### 2.5 Project Manager：生成设置

- **Toolchain / IDE**：MDK-ARM V5
- **Code Generator** 里勾上 `Generate peripheral initialization as a pair of .c/.h files`，外设代码分文件放，主函数不会被初始化代码淹没

点 `GENERATE CODE`。

## 三、工程结构解析

生成的工程里，你主要关心这几个文件：

```
Core/
├── Inc/
│   ├── main.h          ← 引脚宏定义（USER CODE 段里可以加自己的宏）
│   ├── stm32f1xx_hal_conf.h
│   └── gpio.h 等        ← 各外设初始化声明
├── Src/
│   ├── main.c          ← 主逻辑
│   ├── stm32f1xx_it.c  ← 中断服务函数
│   └── gpio.c 等        ← 各外设初始化实现
└── Startup/startup_stm32f103xb.s
```

`main.c` 里有三段你需要理解的结构：

```c
int main(void)
{
    /* 1. HAL 初始化：复位所有外设、初始化 Flash 接口 */
    HAL_Init();

    /* 2. 系统时钟配置：就是你在时钟树里配的那套 */
    SystemClock_Config();

    /* 3. 各外设初始化，由 CubeMX 生成 */
    MX_GPIO_Init();

    /* USER CODE BEGIN 2 */
    /* 你自己的初始化代码写在这里 */
    /* USER CODE END 2 */

    while (1)
    {
        /* USER CODE BEGIN 3 */
        /* 主循环 */
        /* USER CODE END 3 */
    }
}
```

**`USER CODE BEGIN/END` 之间的代码不会被 CubeMX 重新生成时覆盖**。你自己的代码一定要写在这两行之间，否则下次改配置重新生成就全没了。

## 四、第一个程序：LED 闪烁

在主循环里：

```c
/* USER CODE BEGIN 3 */
HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
HAL_Delay(500);
/* USER CODE END 3 */
```

`HAL_Delay` 依赖 SysTick 中断，如果发现程序卡死在这里不动，八成是**中断优先级配置有问题**，或者 SysTick 中断被别的代码屏蔽了。

### 用带时间戳的日志替代 HAL_Delay 调试

`HAL_Delay` 是阻塞的，实际项目里几乎不能用。更好的做法是基于 `HAL_GetTick()` 写非阻塞的定时逻辑：

```c
/* USER CODE BEGIN 0 */
#include <stdio.h>

/* 让 printf 走串口（CubeMX 里要配好 USART1） */
int fputc(int ch, FILE *f)
{
    HAL_UART_Transmit(&huart1, (uint8_t *)&ch, 1, HAL_MAX_DELAY);
    return ch;
}
/* USER CODE END 0 */

/* USER CODE BEGIN 3 */
static uint32_t last_tick = 0;
uint32_t now = HAL_GetTick();

/* 每 500ms 翻转一次，期间 CPU 完全空闲 */
if (now - last_tick >= 500) {
    last_tick = now;
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
    printf("[%lu] toggle, tick=%lu\r\n", now, HAL_GetTick());
}
/* USER CODE END 3 */
```

注意 `now - last_tick` 这种写法而不是 `now >= last_tick + 500`。前者在定时器溢出（约 49 天）时依然正确，后者会出错——这是一条值得养成的习惯。

## 五、下载与调试

Keil 里 `Options for Target → Debug`：

1. 选 `ST-Link Debugger`
2. 点 `Settings`，确认能识别到芯片 ID
3. `Flash Download` 页勾上 `Reset and Run`——这样下载完自动运行，不用手动按复位

下载后 LED 应该开始闪。如果不闪，按这个顺序排查：

| 现象 | 检查点 |
|---|---|
| Keil 提示 No target connected | 驱动、USB 线、SWD 接线（SWCLK/SWDIO/GND 三根必须都对） |
| 能下载但没反应 | 时钟配置对不对？`SystemClock_Config` 里有没有超频 |
| LED 常亮或常灭不闪 | 引脚选错、电平极性反了（看板子原理图） |
| 程序一运行就跑飞 | 中断优先级、栈溢出、`USER CODE` 段被覆盖 |
| 下载一次后再也连不上 | SWD 引脚被复用，用 BOOT0 拉高进入系统存储器模式救回 |

**`Reset and Run` 没勾选**是个很隐蔽的坑：程序下载成功了，但芯片还停在复位状态，看起来就像"下载失败"。

## 六、一套顺手的工程模板

每次新建项目都从头配一遍太浪费时间。建议整理一个自己的模板工程，包含：

- 时钟、SWD、串口（用于日志）都配好
- 已经写好 `fputc` 重定向和分级日志宏
- 一个基于 `HAL_GetTick()` 的软件定时器框架
- 看门狗已启用
- `.gitignore` 排除 `Objects/`、`Listings/` 等编译产物

```c
/* 简单的非阻塞软件定时器，比裸 HAL_Delay 好用得多 */
typedef struct {
    uint32_t period;
    uint32_t last;
} soft_timer_t;

static bool soft_timer_expired(soft_timer_t *t)
{
    uint32_t now = HAL_GetTick();
    if (now - t->last >= t->period) {
        t->last = now;
        return true;
    }
    return false;
}

/* 用法：三个任务互不阻塞 */
static soft_timer_t t_led   = { 500,  0 };
static soft_timer_t t_send  = { 1000, 0 };
static soft_timer_t t_scan  = { 50,   0 };

while (1) {
    if (soft_timer_expired(&t_led))  HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
    if (soft_timer_expired(&t_send)) printf("heartbeat\r\n");
    if (soft_timer_expired(&t_scan)) keyscan_poll();
}
```

这个模式在裸机项目里能覆盖 90% 的定时需求，等到任务再复杂，就该考虑上 RTOS 了。

## 小结

环境搭建本身不难，坑基本都集中在几个固定位置：

1. **RCC 没配 HSE** → 时钟上不去
2. **SYS 没选 Serial Wire** → 只能下载一次
3. **USER CODE 段外写代码** → 重新生成后丢失
4. **`Reset and Run` 没勾** → 以为下载失败
5. **APB 分频超限** → 外设行为诡异

把这五点记住，剩下就是按部就班。环境通了之后，真正的学习从外设驱动才开始。

---

**下一篇**：[深入理解 GPIO 与外部中断机制](#/article/gpio-and-exti-interrupts)
