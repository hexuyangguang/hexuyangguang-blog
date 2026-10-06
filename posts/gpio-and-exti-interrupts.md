GPIO 大概是所有人接触的第一个外设，但真正把它用对的人不多。而中断——从"轮询按键"到"中断响应"这一步，是嵌入式入门的一个重要台阶。

这篇文章从硬件电路讲到 NVIC 优先级，把 GPIO 和外部中断这条链路完整走一遍。

## 一、GPIO 的八种工作模式

STM32 的每个引脚可以配置成 8 种模式，本质上是三个开关的组合：**输入还是输出**、**推挽还是开漏**、**是否上下拉**。

| 模式 | 典型用途 | 关键点 |
|---|---|---|
| 输入浮空 | 外部已有上下拉 | 悬空时电平不定，易受干扰 |
| 输入上拉 | 按键接 GND | 内部约 40kΩ，长线易受干扰 |
| 输入下拉 | 按键接 VCC | 同上 |
| 模拟输入 | ADC 采集 | **必须配这个**，否则读数不准 |
| 推挽输出 | LED、驱动数字信号 | 能主动输出高低电平 |
| 开漏输出 | I2C、电平转换、线与 | 只能拉低，高电平靠外部上拉 |
| 推挽复用 | UART/SPI 的 TX、SCK | 交给外设控制 |
| 开漏复用 | I2C 的 SCL/SDA | 交给外设控制 |

### 1.1 推挽 vs 开漏，到底怎么选

**推挽**内部有上下两个 MOS 管，输出 1 时上面的管子导通接到 VCC，输出 0 时下面的导通接到 GND。**能主动输出高低电平**，驱动能力强。

**开漏**只有下面一个管子。输出 0 时拉低，输出 1 时管子断开，引脚处于**高阻态**，电平完全由外部上拉电阻决定。

什么时候必须用开漏：

```c
/* 场景一：I2C 总线。SCL/SDA 是多设备共享的，必须开漏 + 外部上拉，
 * 否则两个设备同时输出不同电平会短路烧毁。这是硬性要求。 */

/* 场景二：电平转换。3.3V 的 MCU 控制 5V 器件，
 * 3.3V 侧开漏 + 5V 侧上拉，就能安全通信，不需要电平转换芯片。 */

/* 场景三：线与逻辑。多个设备任意一个拉低，总线就是低，
 * 适合做"故障汇总"这类信号。 */
```

**判据**：如果这条线上会挂多个设备，或者需要外接不同电压的器件，用开漏；否则用推挽。

### 1.2 上下拉电阻什么时候必须加

内部上下拉电阻大约 40kΩ，属于**弱上拉**。以下情况必须加外部电阻：

- **长导线**（超过 10cm）—— 分布电容大，弱上拉上升沿太慢，I2C 会直接通信失败
- **强干扰环境** —— 电机、继电器旁边，弱上拉扛不住
- **开漏输出需要快速上升沿** —— I2C 标准模式通常用 4.7kΩ，快速模式用 2.2kΩ

一个实际教训：I2C 用内部上拉，在面包板上能跑，焊到板子上线长了一点就时通时不通。**I2C 一定用外部上拉**，这是经验之谈。

### 1.3 模拟输入模式的坑

ADC 引脚**必须**配置成模拟输入模式（`GPIO_MODE_ANALOG`）。如果配成浮空输入，数字输入缓冲器还挂在引脚上，会:

- 给引脚引入额外漏电流，导致采样值偏低
- 增加引脚电容，影响采样保持时间

现象是"读数总是差点意思"或者"不同通道之间串扰"。这类问题很难查，因为程序逻辑完全正确。

## 二、按钮：从轮询到中断

### 2.1 机械按键必须消抖

机械按键在按下和松开的瞬间，触点会弹跳多次，产生几毫秒的毛刺：

```
理想波形:  ‾‾‾‾|________|‾‾‾‾‾
                     ↑ 一次按下

实际波形:  ‾‾‾|_|‾|__|‾|_______|‾|_|‾‾‾‾
              └─ 抖动 5-20ms ─┘
```

不消抖的话，按一次会触发好几次。两种消抖方式：

**延时消抖**（简单，但阻塞）：

```c
if (HAL_GPIO_ReadPin(KEY_GPIO_Port, KEY_Pin) == GPIO_PIN_RESET) {
    HAL_Delay(20);                    /* 等抖动过去 */
    if (HAL_GPIO_ReadPin(KEY_GPIO_Port, KEY_Pin) == GPIO_PIN_RESET) {
        /* 确认按下 */
    }
}
```

`HAL_Delay` 阻塞 20ms 在简单项目里无所谓，但在 RTOS 或者有实时要求的场合不能用。

**定时器消抖**（推荐，非阻塞）：

```c
typedef struct {
    GPIO_TypeDef *port;
    uint16_t      pin;
    uint8_t       stable;      /* 已确认的稳定电平 */
    uint8_t       last_read;   /* 上次采样的电平 */
    uint32_t      last_change; /* 上次电平变化的时间 */
    uint8_t       pressed;     /* 本次扫描是否检测到按下事件 */
} key_t;

/* 每 5ms 调用一次 */
void key_scan(key_t *k)
{
    uint8_t now = HAL_GPIO_ReadPin(k->port, k->pin);

    if (now != k->last_read) {
        k->last_read   = now;
        k->last_change = HAL_GetTick();
        return;                     /* 电平刚变，继续观察 */
    }

    /* 电平稳定超过 20ms，才认为是真的变化 */
    if (now != k->stable && (HAL_GetTick() - k->last_change) >= 20) {
        k->stable = now;
        if (now == GPIO_PIN_RESET) {
            k->pressed = 1;         /* 记录一次按下事件 */
        }
    }
}

/* 主循环里消费事件，业务逻辑和扫描解耦 */
if (key.pressed) {
    key.pressed = 0;
    handle_key_press();
}
```

这个模式不阻塞任何东西，可以同时扫描多个按键，也能自然支持长按和双击（记录按下持续时间即可）。

### 2.2 外部中断：配置要点

STM32 的 EXTI 有几个必须搞清楚的概念：

**第一，EXTI 线是复用的。** 芯片有 16 条外部中断线 EXTI0~EXTI15，**每条线对应所有端口的同一个引脚号**。PA0、PB0、PC0 共用 EXTI0——你不能同时把 PA0 和 PB0 都配成中断。

```c
/* 选哪个端口作为该 EXTI 线的源，由 AFIO_EXTICR 决定 */
/* HAL 里通过 GPIO 初始化的 Mode 参数指定 */
GPIO_InitStruct.Pin  = GPIO_PIN_0;
GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);   /* 选的是 PA0 */
```

**第二，触发边沿要选对。**

| 模式 | 含义 | 适用 |
|---|---|---|
| `GPIO_MODE_IT_RISING` | 上升沿 | 按键接 GND（按下变低），用于释放检测 |
| `GPIO_MODE_IT_FALLING` | 下降沿 | 按键接 VCC（按下变高），用于按下检测 |
| `GPIO_MODE_IT_RISING_FALLING` | 双边沿 | 编码器、需要测脉宽 |

选错了不是没反应就是触发两次。

**第三，中断服务函数里必须清标志位。** HAL 库提供了统一入口：

```c
/* stm32f1xx_it.c 里自动生成的跳转 */
void EXTI0_IRQHandler(void)
{
    HAL_GPIO_EXTI_IRQHandler(KEY_Pin);
}

/* 你要实现的是这个回调（在 main.c 里写） */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == KEY_Pin) {
        /* 处理按键 */
    }
}
```

`HAL_GPIO_EXTI_IRQHandler` 内部会清除挂起标志再调用回调。**如果你自己写 ISR 而忘了清标志，中断会连续不断地重复触发，程序看起来像死机。**

## 三、NVIC 中断优先级

这是中断部分最容易出错、也最难调试的地方。

### 3.1 优先级的两个维度

Cortex-M 的每个中断有两个优先级属性：

- **抢占优先级（Preemption Priority）**：数值小的能打断数值大的，形成嵌套
- **响应优先级 / 子优先级（Sub Priority）**：只在抢占优先级相同时决定谁先执行，**不能嵌套**

两者各占几位由 `NVIC_PriorityGroupConfig` 决定：

| 分组 | 抢占位 | 子优先级位 | 抢占级数 | 子优先级数 |
|---|---|---|---|---|
| NVIC_PRIORITYGROUP_0 | 0 | 4 | 1 | 16 |
| NVIC_PRIORITYGROUP_1 | 1 | 3 | 2 | 8 |
| NVIC_PRIORITYGROUP_2 | 2 | 2 | 4 | 4 |
| NVIC_PRIORITYGROUP_3 | 3 | 1 | 8 | 2 |
| NVIC_PRIORITYGROUP_4 | 4 | 0 | 16 | 1 |

**整个工程必须统一用同一个分组**，通常在 `main` 开头设置一次。HAL 默认用 GROUP_4，也就是只有抢占优先级，没有子优先级——这个选择对大多数项目够用。

### 3.2 优先级该怎么分配

一个实用的分层：

```c
/* 最高：影响系统安全，必须立即响应 */
#define PRIO_FAULT      0    /* 硬件错误、看门狗 */

/* 次高：实时性要求严格 */
#define PRIO_MOTOR      5    /* 电机控制、PWM 换相 */

/* 中等：普通外设 */
#define PRIO_UART_RX    8    /* 串口接收，丢了会丢数据 */
#define PRIO_EXTI_KEY   9    /* 按键 */

/* 最低：不着急的 */
#define PRIO_TIMER_SOFT 14
#define PRIO_SYSTICK    15   /* HAL_Delay 依赖它 */

HAL_NVIC_SetPriority(EXTI0_IRQn, PRIO_EXTI_KEY, 0);
HAL_NVIC_EnableIRQ(EXTI0_IRQn);
```

**SysTick 设成最低**是有意为之：`HAL_Delay` 只是延时用，不应该抢占任何实际业务。

### 3.3 三条铁律

**铁律一：ISR 里不能调用 `HAL_Delay`。**

```c
/* 错误 —— 会直接死锁 */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    HAL_Delay(10);      /* 等 SysTick 中断，但它的优先级比当前 ISR 低 */
}
```

如果 EXTI 的抢占优先级高于 SysTick，`HAL_Delay` 里的计数器**永远不会增加**，程序卡死在中断里。这就是为什么 SysTick 要设成最低优先级。

**铁律二：ISR 要尽可能短。** 中断执行期间，同级和低级中断都被挡住。正确做法是"中断里只置标志，主循环里干活"：

```c
/* ISR：只做最少的事 */
static volatile uint8_t g_key_event = 0;

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == KEY_Pin) {
        g_key_event = 1;        /* 就这一行 */
    }
}

/* 主循环：处理实际逻辑 */
while (1) {
    if (g_key_event) {
        g_key_event = 0;
        do_something_slow();    /* 耗时操作放这里 */
    }
}
```

**铁律三：主循环和 ISR 共享的变量必须加 `volatile`。**

```c
static volatile uint8_t g_key_event = 0;
/*      ^^^^^^^^ 不加的话，主循环里的 while(!g_key_event) 会被优化成死循环 */
```

## 四、中断没反应的排查顺序

按这个顺序查，能覆盖 95% 的情况：

1. **时钟使能了吗** —— SYSCFG/AFIO 和 GPIO 的时钟都要开。用 CubeMX 生成的话这一步自动做了，手写寄存器最容易漏。
2. **NVIC 使能了吗** —— 配了 EXTI 但没 `HAL_NVIC_EnableIRQ`，一样不触发。
3. **AFIO 的 EXTI 源选对了吗** —— PA0 和 PB0 抢 EXTI0，后配的会赢。
4. **触发边沿对吗** —— 示波器看一眼实际波形，别靠猜。
5. **ISR 函数名拼对了吗** —— `EXTI0_IRQHandler` 少个字母，链接器不会报错，只是永远不执行。
6. **标志位清了吗** —— 没清的话会反复进中断，表现是"主程序几乎不跑"。
7. **是不是一直在触发** —— 信号有抖动，或者上拉没加导致引脚浮动。

第 5 条特别隐蔽。**函数名拼错不会有任何编译警告**，因为启动文件里的中断向量表用的是弱符号，你的函数没匹配上就直接用了默认的空实现。查这个问题时，可以在 ISR 里翻转一个空闲 GPIO，用示波器看有没有动。

## 小结

| 主题 | 关键结论 |
|---|---|
| 推挽/开漏 | 总线共享或跨电压 → 开漏 + 外部上拉 |
| 上下拉 | 内部 40kΩ 是弱上拉，长线/强干扰/I2C 必须外部加 |
| ADC 引脚 | 必须配模拟输入，否则读数不准 |
| 按键 | 必须消抖，优先用非阻塞的定时器扫描 |
| EXTI | 16 条线跨端口复用，同号引脚只能选一个 |
| 优先级 | 全工程统一分组；SysTick 设最低；ISR 要短 |
| 共享变量 | ISR 和主循环共享的必须加 `volatile` |

GPIO 和中断是后面所有外设的基础。把这块的电路概念和软件配置都理顺，学定时器、串口、DMA 的时候会顺很多。

---

**相关文章**：[C语言指针与位操作：嵌入式的两大基本功](#/article/c-pointers-and-bitops) · [嵌入式调试利器：JTAG、逻辑分析仪与示波器](#/article/debugging-tools)
