从裸机大循环跨到 RTOS，最大的变化不是多了一套 API，而是**思维方式要换**。

裸机时代你是"一个人干所有事"，RTOS 时代是"带一个团队"。团队协作就有分工、有优先级、有资源争夺——这篇文章讲的就是怎么管好这个团队。

## 一、裸机为什么不够用

先看一个典型的裸机程序：

```c
void main(void)
{
    init_all();

    while (1) {
        keyscan_poll();         /* 快，几十微秒 */
        read_sensor();          /* 慢，I2C 读取要 5ms */
        update_display();       /* 很慢，刷屏要 30ms */
        send_to_cloud();        /* 不定，可能阻塞几百毫秒 */
    }
}
```

问题在哪：

- **响应不及时**。`send_to_cloud()` 卡住 500ms 时，按键完全没反应
- **节奏互相牵制**。想 1ms 扫一次按键、1s 读一次传感器，混在一个循环里很难写
- **代码越来越乱**。功能加到第五个，循环里的状态机就不好维护了

理论上可以用状态机 + 定时器把裸机写得很好，但**代码复杂度会随功能数量指数上升**。RTOS 用一个简单的抽象——"每个功能一个任务"——把这个问题化解了。

## 二、任务：基本单位

```c
void vTaskLed(void *pvParameters)
{
    for (;;) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        vTaskDelay(pdMS_TO_TICKS(500));    /* 让出 CPU 500ms */
    }
}

void vTaskSensor(void *pvParameters)
{
    for (;;) {
        float temp, humi;
        if (sht30_read(&temp, &humi) == 0) {
            printf("温度 %.1f 湿度 %.1f\r\n", temp, humi);
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

int main(void)
{
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();

    xTaskCreate(vTaskLed,    "LED",    256, NULL, 2, NULL);
    xTaskCreate(vTaskSensor, "SENSOR", 512, NULL, 3, NULL);

    vTaskStartScheduler();      /* 启动调度器后不会返回 */

    for (;;);                   /* 走到这里说明堆内存不够，任务创建失败 */
}
```

### 任务的关键约束

**每个任务必须有阻塞点。** 如果某个任务是个死循环且从不调用会阻塞的 API，**同优先级和低优先级的任务永远得不到执行**：

```c
/* 错误：饿死其他任务 */
void vTaskBad(void *p)
{
    for (;;) {
        do_something();
        /* 没有任何阻塞，这个任务会一直霸占 CPU */
    }
}

/* 正确：哪怕加一个最小的延时 */
void vTaskGood(void *p)
{
    for (;;) {
        do_something();
        vTaskDelay(1);      /* 至少让调度器有机会切换 */
    }
}
```

**任务的栈要够用。** 栈是任务私有的，用来放局部变量、函数调用返回地址。栈溢出是 RTOS 最隐蔽的 bug 之一——**它可能跑几天才崩**。

```c
/* 用这个钩子函数在溢出时立刻停下来，方便定位 */
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
    printf("!!! 栈溢出: %s\r\n", pcTaskName);
    taskDISABLE_INTERRUPTS();
    for (;;);       /* 停在这里，用调试器看是哪个任务 */
}

/* configCHECK_FOR_STACK_OVERFLOW 要设成 2 */
```

栈大小该给多少？用 FreeRTOS 自带的**高水位线**功能实测：

```c
/* 任务运行一段时间后（覆盖所有代码路径）调用一次 */
UBaseType_t hw = uxTaskGetStackHighWaterMark(NULL);
printf("剩余栈空间: %u 字\r\n", hw);
```

返回值是**历史最小剩余量（以字为单位，STM32 上一个字 4 字节）**。如果小于 20 就很危险了，要加大栈。建议按实测峰值的 1.5 倍来配。

## 三、调度：抢占式是怎么回事

FreeRTOS 默认是**抢占式调度**：高优先级任务一旦就绪，立刻打断正在运行的低优先级任务。

```
时间 →
低优先级任务  ██████░░░░░░░░██████████░░░░░░
高优先级任务  ░░░░░░██████░░░░░░░░░░░░██████
              ↑      ↑     ↑            ↑
            就绪   抢占   阻塞          再次抢占
```

### 3.1 优先级数值越大越高

这一点和中断优先级**正好相反**，非常容易搞混：

| | 数值大 | 数值小 |
|---|---|---|
| FreeRTOS 任务优先级 | **更高** | 更低 |
| Cortex-M 中断优先级 | **更低** | 更高 |

```c
#define PRIO_LOW      1
#define PRIO_NORMAL   3
#define PRIO_HIGH     5     /* 比 PRIO_LOW 高 */

xTaskCreate(vTaskHigh,   "H", 256, NULL, PRIO_HIGH,   NULL);
xTaskCreate(vTaskLow,    "L", 256, NULL, PRIO_LOW,    NULL);
```

### 3.2 任务状态迁移

```
              xTaskCreate
                   ↓
              ┌─────────┐
              │  就绪   │ ←──────────┐
              └────┬────┘            │
      调度器选中    │                 │ 事件到来
                   ↓                 │ 或超时
              ┌─────────┐       ┌────┴────┐
              │  运行   │──────>│  阻塞   │
              └────┬────┘       └─────────┘
                   │
        vTaskDelete│  等待资源
                   ↓
              ┌─────────┐
              │ 挂起/删除│
              └─────────┘
```

关键点：**只有处于"就绪"状态的任务才会被调度**。调用了 `vTaskDelay`、等待队列/信号量、等待事件组的任务都在"阻塞"状态，不占用 CPU。

### 3.3 空闲任务和它不能省的事

调度器启动时会自动创建一个**空闲任务**（优先级 0），在所有任务都阻塞时运行。它负责清理被删除任务的内存。

空闲任务里可以挂一个钩子做低优先级工作：

```c
/* configUSE_IDLE_HOOK 设为 1 */
void vApplicationIdleHook(void)
{
    /* 这里不能调用任何会阻塞的 API */
    __WFI();        /* 进低功耗模式，等中断唤醒，省电 */
}
```

**注意**：空闲钩子里不能用 `vTaskDelay` 或任何 `...Wait` 结尾的 API，因为空闲任务优先级最低，阻塞它没有意义还会触发断言。

## 四、优先级设计：别把 RTOS 用成裸机

一个常见的错误是**给所有任务都设成一样的高优先级**，结果调度退化成时间片轮转，实时性反而没了。

合理的分层（数值越小优先级越低，这里用实际数值举例）：

| 优先级 | 用途 | 例子 |
|---|---|---|
| 0 | 空闲任务 | 系统占用，不要动 |
| 1 | 后台任务 | 日志落盘、参数保存 |
| 2 | 普通业务 | 显示刷新、LED 指示 |
| 3 | 数据处理 | 传感器融合、协议解析 |
| 4 | 通信 | 串口/MQTT 收发 |
| 5 | 实时控制 | 电机 PID、保护逻辑 |
| 6+ | 保留 | 慎用，太高会让其他任务饿死 |

**原则**：只给**真正有实时要求**的任务高优先级，其余的任务优先级尽量低且分散。

## 五、共享资源与优先级反转

这是 RTOS 里最重要的一个概念，也是面试高频题。

### 5.1 问题是怎么发生的

假设三个任务：L（低优先级）、M（中优先级）、H（高优先级），它们都要用同一个资源（比如一个 I2C 总线）。

```
时刻:      1    2    3    4    5    6    7
H(高):     █    ░    ░    ░    ░    ░    █
M(中):     ░    ░    ████████████████    ░
L(低):     ░    ████████████████    ░    ░
                ↑                ↑
              拿到锁          L 被 M 抢占，
                             H 只能干等
```

过程是这样的：

1. L 先运行，拿到了锁
2. H 就绪，抢占 L，但发现锁被占，只能阻塞等待
3. L 恢复运行准备释放锁
4. **M 就绪，因为比 L 优先级高，抢占了 L**
5. M 跑了很久，L 一直没机会释放锁
6. 结果 **H 被 M 间接阻塞了**——高优先级任务等中优先级任务

这就是**优先级反转**：H 的实际响应时间被 M 决定了，完全违背了优先级的设计初衷。

1997 年火星探路者号就因为这个 bug 反复重启，NASA 最后靠远程打补丁才救回来。

### 5.2 两种解决办法

**方法一：优先级继承（Priority Inheritance）**

当 H 因为等待 L 持有的锁而阻塞时，**临时把 L 的优先级提升到 H 的级别**，这样 M 就抢不过 L 了，L 能尽快执行完并释放锁。

```c
/* 互斥量（Mutex）默认启用优先级继承 */
SemaphoreHandle_t xMutex = xSemaphoreCreateMutex();

void vTaskHigh(void *p)
{
    for (;;) {
        if (xSemaphoreTake(xMutex, portMAX_DELAY) == pdTRUE) {
            /* 临界区：尽量短 */
            access_shared_resource();
            xSemaphoreGive(xMutex);
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
```

**方法二：优先级天花板（Priority Ceiling）**

创建互斥量时就声明"用到这个锁的任务里最高优先级是多少"，任何任务拿锁时直接被提升到那个级别。FreeRTOS 需要通过 `xSemaphoreCreateMutexStatic` 配合配置项实现，用得比继承少。

### 5.3 必须用互斥量，不能用二值信号量

这是关键区别，很多人搞混：

| | 二值信号量 | 互斥量 |
|---|---|---|
| 用途 | **任务间同步** | **保护共享资源** |
| 优先级继承 | ❌ 不支持 | ✅ 支持 |
| 递归获取 | ❌ | ✅（递归互斥量） |
| 在 ISR 中使用 | ✅ | ❌ |

```c
/* 保护共享资源 —— 用互斥量 */
SemaphoreHandle_t mutex = xSemaphoreCreateMutex();

/* 任务同步（ISR 通知任务）—— 用二值信号量 */
SemaphoreHandle_t sem = xSemaphoreCreateBinary();
```

**用二值信号量保护资源，优先级反转就无法避免。**

### 5.4 临界区：比锁更轻的选择

如果临界区只有几条指令，用临界区比互斥量更高效：

```c
/* 关中断（会短暂影响实时性） */
taskENTER_CRITICAL();
g_shared_counter++;
taskEXIT_CRITICAL();

/* 只关调度器（中断照常响应，但不能切换任务） */
vTaskSuspendAll();
g_shared_buffer_len = 0;
xTaskResumeAll();
```

**选择的经验法则**：

- 几条指令的操作 → 临界区
- 可能阻塞的操作（I2C 读、Flash 写）→ 互斥量
- **临界区里绝不能调用任何 FreeRTOS 的阻塞 API**，会直接触发断言

## 六、任务间通信

### 6.1 队列：最常用的方式

```c
typedef struct {
    uint16_t temp;
    uint16_t humi;
    uint32_t timestamp;
} sensor_msg_t;

QueueHandle_t xQueue = xQueueCreate(8, sizeof(sensor_msg_t));

/* 生产者：采集任务 */
void vTaskAcquire(void *p)
{
    sensor_msg_t msg;
    for (;;) {
        msg.temp = read_temp();
        msg.humi = read_humi();
        msg.timestamp = HAL_GetTick();

        /* 队列满时等 10ms，还满就丢弃这一条，避免采集任务被卡住 */
        if (xQueueSend(xQueue, &msg, pdMS_TO_TICKS(10)) != pdTRUE) {
            printf("队列满，丢弃一条数据\r\n");
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

/* 消费者：上报任务 */
void vTaskReport(void *p)
{
    sensor_msg_t msg;
    for (;;) {
        /* 阻塞等待，直到有数据 */
        if (xQueueReceive(xQueue, &msg, portMAX_DELAY) == pdTRUE) {
            upload_to_cloud(&msg);
        }
    }
}
```

队列自带**拷贝语义**，数据被复制进队列，生产者和消费者不共享内存，天然线程安全。

### 6.2 中断里要用的 API 带 FromISR 后缀

```c
/* 中断服务函数里发送队列 */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    uint8_t evt = 1;

    xQueueSendFromISR(xQueue, &evt, &xHigherPriorityTaskWoken);

    /* 如果唤醒了更高优先级的任务，请求一次上下文切换 */
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

**`portYIELD_FROM_ISR` 不能省。** 否则被唤醒的高优先级任务要等到下一个 tick 才能运行，实时性打折扣。

**中断的优先级也有讲究**：FreeRTOS 的 API 只能在优先级**数值上 >= `configMAX_SYSCALL_INTERRUPT_PRIORITY`** 的中断里调用（即优先级不能太高）。设得太高的中断不受 RTOS 管理，在里面调 API 会导致内存损坏。

```c
/* 正确设置：数值 5 及以上（即优先级低于等于 5）的中断才能调 FreeRTOS API */
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY  5

/* EXTI 优先级要设成这个值或更低的优先级 */
HAL_NVIC_SetPriority(EXTI0_IRQn, 5, 0);
```

## 七、调试：卡死了怎么办

RTOS 程序死机比裸机难查，因为"程序在哪"不再是一个确定的位置。几个实用手段：

**1. 看是哪个任务在跑**

Keil 或 CubeIDE 的 RTOS 插件能直接显示任务列表、状态和栈水位。调试时先看这个。

**2. 装一个运行时统计**

```c
/* FreeRTOSConfig.h 里打开这两个 */
#define configUSE_TRACE_FACILITY          1
#define configGENERATE_RUN_TIME_STATS     1

/* 打印各任务的 CPU 占用和栈使用 */
void print_task_stats(void)
{
    printf("任务名      状态   优先级  剩余栈  占用%%\r\n");
    vTaskList(task_buf);        /* 需要 configUSE_TRACE_FACILITY */
    printf("%s\r\n", task_buf);
}
```

CPU 占用率能直观暴露"哪个任务在空转"——如果某个任务的占用接近 100%，那它就是个死循环。

**3. 卡在 configASSERT 里**

FreeRTOS 内部检测到非法操作会调用 `configASSERT`。**一定要把它实现成死循环 + 打印**，而不是空宏：

```c
#define configASSERT(x) \
    if ((x) == 0) { \
        printf("ASSERT 失败: %s:%d\r\n", __FILE__, __LINE__); \
        taskDISABLE_INTERRUPTS(); \
        for (;;); \
    }
```

最常见的断言触发原因：在中断里调了非 FromISR 版本的 API、临界区里调了阻塞 API、队列大小为 0。

## 小结

| 主题 | 必须记住的 |
|---|---|
| 任务 | 每个任务都要有阻塞点；栈大小用高水位线实测 |
| 优先级 | 数值越大优先级越高（和中断相反）；只给真正实时的任务高优先级 |
| 共享资源 | 用**互斥量**不是二值信号量；临界区要短 |
| 优先级反转 | 互斥量自带优先级继承；临界区只有几条指令时才用 |
| ISR 通信 | 用 `FromISR` 版本 API，结尾必须 `portYIELD_FROM_ISR` |
| 中断优先级 | 数值不能高于 `configMAX_SYSCALL_INTERRUPT_PRIORITY` |
| 调试 | 打开运行时统计看 CPU 占用；`configASSERT` 要能停下来 |

RTOS 的价值不在于"能跑多任务"，而在于**把复杂的时序关系变成清晰的任务划分**。设计阶段花时间想清楚任务该怎么切分、优先级怎么排、哪些资源要保护，比后面调试省事得多。

---

**相关文章**：[深入理解 GPIO 与外部中断机制](#/article/gpio-and-exti-interrupts) · [嵌入式调试利器：JTAG、逻辑分析仪与示波器](#/article/debugging-tools)
