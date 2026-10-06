在 PC 上写 C 语言，指针用不明白顶多是代码丑一点；在嵌入式里，指针和位操作不会，基本上寸步难行——**寄存器访问、DMA 缓冲区、协议解析、驱动注册，底层代码里到处都是它们**。

这篇文章不讲语法书上那些概念，只讲嵌入式场景里真正每天都会用到的那部分。

## 一、指针：从"指向变量"到"指向地址"

### 1.1 寄存器映射的本质

你写 `GPIOA->ODR = 0x20;`，编译器实际做的事情是：

```c
/* 你写的 */
GPIOA->ODR = 0x20;

/* 它真正等价于 */
*(volatile uint32_t *)0x40020014 = 0x20;
```

拆开看这三步：

1. `0x40020014` 是一个整数
2. `(volatile uint32_t *)` 告诉编译器"把这个整数当指针看，指向一个 32 位无符号数"
3. 前面的 `*` 解引用，往这个地址写值

**关键点**：在嵌入式中，指针的值不是"某个变量的地址"，而是一个**硬件协议约定的物理地址**。数据手册上写的 `0x4002 0014`，就是你代码里的常量。

一颗 STM32F103 的 GPIO 寄存器组可以这样组织：

```c
typedef struct {
    volatile uint32_t CRL;    /* 0x00 端口配置低寄存器  */
    volatile uint32_t CRH;    /* 0x04 端口配置高寄存器  */
    volatile uint32_t IDR;    /* 0x08 输入数据寄存器    */
    volatile uint32_t ODR;    /* 0x0C 输出数据寄存器    */
    volatile uint32_t BSRR;   /* 0x10 位设置/清除寄存器 */
    volatile uint32_t BRR;    /* 0x14 位复位寄存器      */
    volatile uint32_t LCKR;   /* 0x18 配置锁定寄存器    */
} GPIO_TypeDef;

#define GPIOA  ((GPIO_TypeDef *)0x40010800UL)
#define GPIOB  ((GPIO_TypeDef *)0x40010C00UL)
```

这样 `GPIOA->ODR` 和 `GPIOB->ODR` 就自动相差 `0x400`，和手册上的地址偏移一一对应。**结构体在这里的作用不是打包数据，而是描述地址布局**。

### 1.2 为什么必须加 volatile

这是新手最容易忽略、也最容易出诡异 bug 的地方。

```c
/* 错误写法：等待硬件把状态位置 1 */
uint32_t *status = (uint32_t *)0x40001000;
while ((*status & 0x01) == 0) {
    /* 等待 */
}
```

打开 `-O2` 编译，这段会变成**死循环**。因为编译器看到循环体里没有修改 `*status`，就认为条件永远不变，直接优化成 `if` 或者干脆无限循环。

加上 `volatile` 就对了：

```c
/* 正确写法 */
volatile uint32_t *status = (volatile uint32_t *)0x40001000;
while ((*status & 0x01) == 0) {
    /* 每次都真正去读内存 */
}
```

`volatile` 的含义是"**这个值可能被程序之外的东西改变，每次访问都必须实际读写内存**"。它管三件事：

- 不要让编译器把多次读取合并成一次
- 不要把它缓存在寄存器里
- 不要改变访问顺序

**注意**：`volatile` 不保证原子性，也不解决多核/多任务竞争。两个任务同时 `count++`，加 `volatile` 一样会出错，那需要临界区保护。

### 1.3 函数指针：驱动注册表

函数指针在嵌入式中最重要的用途，是**把一堆同类操作组织成表**，用统一的方式调用。

比如一个传感器驱动接口：

```c
typedef struct {
    const char *name;
    int  (*init)(void);
    int  (*read)(float *value);
    int  (*sleep)(void);
    int  (*wakeup)(void);
} sensor_ops_t;

/* 两种传感器的实现 */
static int sht30_init(void)   { /* ... */ return 0; }
static int sht30_read(float *v) { /* ... */ return 0; }

static int mpu6050_init(void)   { /* ... */ return 0; }
static int mpu6050_read(float *v) { /* ... */ return 0; }

/* 注册表：加新传感器只要在这里加一行 */
static const sensor_ops_t sensors[] = {
    { "SHT30",   sht30_init,   sht30_read,   NULL, NULL },
    { "MPU6050", mpu6050_init, mpu6050_read, NULL, NULL },
};
```

上层业务代码完全不需要知道具体是哪个传感器：

```c
int sensor_register_and_read(const sensor_ops_t *ops, float *out)
{
    if (!ops || !ops->init || !ops->read) return -1;
    if (ops->init() != 0) return -2;
    return ops->read(out);
}
```

这就是 Linux 驱动模型的微缩版——`file_operations` 结构体是同一个思路。

### 1.4 二级指针：改指针本身

一级指针能改"指针指向的内容"，二级指针能改"指针本身"。

典型场景是**函数内部分配内存，把地址传出去**：

```c
/* 错误：p 是局部变量，出了函数就没了，调用方拿不到地址 */
void alloc_bad(uint8_t *buf, uint32_t len)
{
    buf = malloc(len);      /* 只改了副本 */
}

/* 正确：传指针的地址，才能修改调用方手里的那个指针 */
int alloc_good(uint8_t **out, uint32_t len)
{
    if (!out || len == 0) return -1;

    uint8_t *buf = malloc(len);
    if (!buf) return -2;

    *out = buf;             /* 写回调用方的指针变量 */
    return 0;
}

/* 调用方 */
uint8_t *rx_buf = NULL;
if (alloc_good(&rx_buf, 256) == 0) {
    /* 现在 rx_buf 有效了 */
}
```

判断该用几级指针的土办法：**问自己"我要改什么"**。

| 想改的东西 | 参数写成 |
|---|---|
| 一个 int 的值 | `int *p` |
| 一个 `uint8_t *` 的值 | `uint8_t **p` |
| 一个结构体字段 | `struct *p` |
| 一个数组的内容 | `uint8_t *p` 或 `uint8_t p[]` |

## 二、位操作：配置寄存器的唯一手段

寄存器是**按位定义**的，一个 32 位寄存器里可能塞了 8 个引脚的配置，每个占 4 位。你不可能整体赋值，只能按位操作。

### 2.1 四个基本运算

```c
x |=  (1U << n);          /* 置位：把第 n 位置 1，其他位不变 */
x &= ~(1U << n);          /* 清零：把第 n 位置 0，其他位不变 */
x ^=  (1U << n);          /* 翻转：第 n 位取反 */
if (x & (1U << n)) { }    /* 读位：判断第 n 位是不是 1 */
```

四个操作里，**第二个最容易写错**。`x &= ~(1U << n)` 里的 `~` 不能省——`x &= (1U << n)` 是"只保留第 n 位，其他全清零"，和清零完全是两回事。

### 2.2 多位字段：先清后写

当一个字段占多个位（比如 GPIO 的模式位每个引脚占 2 位、定时器的预分频占 16 位），标准套路是**先清掉这一片，再或进新值**：

```c
/* 把 TIM2 的预分频器设成 7199（72MHz / 7200 = 10kHz） */
#define PSC_MASK  (0xFFFFUL << 0)
#define PSC_SHIFT (0)

TIM2->PSC &= ~PSC_MASK;                 /* 第一步：清空字段 */
TIM2->PSC |= (7199UL << PSC_SHIFT);     /* 第二步：写入新值 */
```

漏掉第一步会怎样？如果原来 PSC 是 `0xFFFF`，你只想写 `0x0064`，结果是 `0xFFFF | 0x0064 = 0xFFFF`，值根本没变。

封装成宏会清爽很多：

```c
#define FIELD_SET(reg, mask, shift, val) \
    do { (reg) = ((reg) & ~(mask)) | (((val) << (shift)) & (mask)); } while (0)

#define FIELD_GET(reg, mask, shift) \
    (((reg) & (mask)) >> (shift))

/* 用法 */
FIELD_SET(TIM2->PSC, 0xFFFFUL, 0, 7199UL);
uint32_t cur = FIELD_GET(TIM2->PSC, 0xFFFFUL, 0);
```

`do { ... } while (0)` 是个必须记住的惯用法：它让宏在语法上表现得像一条普通语句，可以安全地写在 `if` 后面而不用加大括号。

### 2.3 位带别名：Cortex-M 的独门技巧

Cortex-M3/M4 有个硬件特性叫**位带（Bit-Banding）**：把某段内存的每个位，映射到另一段地址的整整一个 32 位字上。

于是"原子地操作一个位"就变成了普通的内存读写：

```c
#define BITBAND_PERIPH_BASE  0x42000000UL
#define PERIPH_BASE          0x40000000UL
#define BITBAND_ALIAS(p, b)  (*(volatile uint32_t *) \
    (BITBAND_PERIPH_BASE + (((uint32_t)(p) - PERIPH_BASE) << 5) + ((b) << 2)))

/* 原来的读-改-写三步操作 */
GPIOA->ODR |= (1UL << 5);

/* 位带写法：一条 STR 指令搞定，天然原子 */
BITBAND_ALIAS(&GPIOA->ODR, 5) = 1;
```

好处有两个：**代码更短**，而且**不需要关中断就是原子的**——因为它是一条指令，不会被中断打断。在中断和主循环都会操作同一个标志位时，这一点很关键。

### 2.4 位域：可读性换可移植性

C 语言的位域允许你把结构体字段声明成占几个位：

```c
typedef struct {
    uint8_t enable    : 1;
    uint8_t mode      : 2;
    uint8_t speed     : 3;
    uint8_t reserved  : 2;
} ctrl_reg_t;
```

看起来很优雅，但在嵌入式中要**谨慎使用**，因为：

- **位序依赖编译器**。小端和大端、不同编译器的分配顺序可能相反
- **不能用来解析协议**。你按位域定义的结构体去 memcpy 一段网络数据，字节序几乎一定对不上
- **访问效率可能更低**。编译器要生成掩码和移位序列，不如直接操作快

**实践建议**：位域只在**纯粹内部的、不涉及外部数据布局**的场景用。解析协议报文时，老老实实写移位和掩码：

```c
/* 解析 2 字节报文：bit15 是标志，bit14-8 是类型，bit7-0 是数据 */
uint16_t frame = ((uint16_t)buf[0] << 8) | buf[1];

uint8_t  flag = (frame >> 15) & 0x01;
uint8_t  type = (frame >> 8)  & 0x7F;
uint8_t  data = frame & 0xFF;
```

这样写出来，字节序清清楚楚，换个平台也不会出问题。

### 2.5 几个常用技巧

```c
/* 1. 判断是不是 2 的幂 */
#define IS_POWER_OF_TWO(x)  ((x) != 0 && (((x) & ((x) - 1)) == 0))

/* 2. 向上对齐到 4 字节（DMA 缓冲区常用） */
#define ALIGN_UP_4(x)  (((x) + 3U) & ~3U)

/* 3. 取最低位的 1（FreeRTOS 调度器就这么找就绪任务） */
#define LOWEST_BIT(x)  ((x) & (~(x) + 1U))

/* 4. 统计 1 的个数 */
static uint8_t popcount(uint32_t x)
{
    x = x - ((x >> 1) & 0x55555555U);
    x = (x & 0x33333333U) + ((x >> 2) & 0x33333333U);
    x = (x + (x >> 4)) & 0x0F0F0F0FU;
    return (uint8_t)((x * 0x01010101U) >> 24);
}
```

第 4 个虽然 Cortex-M4 有 `__builtin_popcount` 可以直接用，但理解这个算法有助于看懂很多底层代码。

## 三、两个实战场景

### 3.1 从一个字节里拆两个传感器读数

温湿度传感器常见做法是用一个 16 位字段表示温度：

```c
/* 原始值：bit15-4 是整数部分，bit3-0 是小数部分 */
static float parse_temperature(uint16_t raw)
{
    int16_t integer = (int16_t)(raw >> 4);
    /* 处理负数：传感器用补码表示 */
    float decimal = (float)(raw & 0x0F) * 0.0625f;
    return (float)integer + (integer < 0 ? -decimal : decimal);
}
```

如果不做位操作，你没法从这个 16 位整数里拿出任何有意义的信息。

### 3.2 用位掩码管理多个标志位

一个 32 位变量可以当"32 个独立布尔量"用，省 RAM 而且在中断里操作很快：

```c
#define FLAG_WIFI_OK      (1UL << 0)
#define FLAG_MQTT_OK      (1UL << 1)
#define FLAG_SENSOR_ERR   (1UL << 2)
#define FLAG_RTC_SYNCED   (1UL << 3)

static volatile uint32_t g_flags = 0;

static inline void flag_set(uint32_t f)   { g_flags |=  f; }
static inline void flag_clr(uint32_t f)   { g_flags &= ~f; }
static inline bool flag_test(uint32_t f)  { return (g_flags & f) != 0; }

/* 一次判断多个条件 */
if (flag_test(FLAG_WIFI_OK | FLAG_MQTT_OK)) {
    publish_data();
}
```

在 RAM 只有几 KB 的单片机上，这种方式比定义一堆 `bool` 变量划算得多。

## 小结

| 主题 | 必须记住的 |
|---|---|
| 寄存器映射 | 物理地址 + 强转指针 + 解引用，结构体描述地址布局 |
| `volatile` | 硬件寄存器、中断共享变量必须加；不保证原子性 |
| 函数指针 | 驱动注册表、回调，Linux 驱动模型的雏形 |
| 二级指针 | 要改指针本身就得传 `**` |
| 位操作 | 置位 `\|=`、清零 `&= ~`、多位字段**先清后写** |
| 位域 | 内部结构可以用，**解析协议不要用** |

这两样东西没有捷径，唯一的办法是在真实的寄存器配置和协议解析里反复用。建议找一颗芯片的手册，挑一个外设（比如 UART），从时钟使能到发送第一个字节，全程只用寄存器操作写一遍——写完你对指针和位操作的理解会上一个台阶。

---

**相关文章**：[深入理解 GPIO 与外部中断机制](#/article/gpio-and-exti-interrupts) · [串口、I2C、SPI 三大总线对比与实战](#/article/uart-i2c-spi)
