嵌入式 Linux 的门槛比单片机高一个量级，不是因为某个知识点特别难，而是**环节太多**：工具链、Bootloader、内核、设备树、根文件系统，任何一环出错板子都起不来。

这篇文章把整条链路串一遍，重点是让你理解**从上电到进入 shell，每一环到底做了什么**。

## 一、为什么需要交叉编译

你的开发机是 x86_64，目标板是 ARM。两者的指令集不同，**x86 编译器生成的机器码在 ARM 上根本跑不了**。

交叉编译就是"在 A 平台上编译出能在 B 平台上运行的代码"：

```
x86_64 开发机                        ARM 目标板
┌─────────────────┐                ┌──────────────┐
│ arm-linux-gnue- │  生成 ARM 可执行 │              │
│ abihf-gcc       │───────────────►│  执行        │
│                 │    文件        │              │
└─────────────────┘                └──────────────┘
```

### 1.1 交叉编译器的命名规则

看懂工具链名字就读懂了一半：

```
arm-linux-gnueabihf-gcc
 │    │      │    │   └── 编译器
 │    │      │    └────── ABI：hard float（硬件浮点）
 │    │      └─────────── 应用二进制接口：gnueabi
 │    └────────────────── 操作系统：Linux
 └─────────────────────── 架构：ARM
```

常见组合：

| 名字片段 | 含义 | 适用 |
|---|---|---|
| `arm-linux-gnueabi` | 软浮点 | 老芯片，无 FPU |
| `arm-linux-gnueabihf` | 硬浮点 | **Cortex-A 系列，最常用** |
| `aarch64-linux-gnu` | 64 位 ARM | Cortex-A53 及以上 |
| `arm-none-eabi` | 无操作系统 | **裸机 / RTOS 用这个** |

**用错 ABI 的后果**：链接时报 `uses VFP register arguments, does not` 之类的错误，或者更糟——编译通过但运行时浮点运算结果全错。

### 1.2 工具链从哪来

三个来源，按推荐顺序：

1. **芯片厂商定制的 SDK**。NXP、TI、瑞芯微都会提供配套工具链，兼容性最好，优先用。
2. **Buildroot / Yocto 自动生成**。会连同根文件系统一起构建，适合做产品。
3. **Linaro 或 ARM 官方预编译版本**。适合学习和快速验证。

安装后验证：

```bash
# 加到 PATH
export PATH=$PATH:/opt/gcc-arm-linux-gnueabihf/bin

# 验证
arm-linux-gnueabihf-gcc -v
# 应该看到 Target: arm-linux-gnueabihf 而不是 x86_64

# 编译一个测试程序
cat > hello.c <<'EOF'
#include <stdio.h>
int main(void) { printf("hello from arm\n"); return 0; }
EOF

arm-linux-gnueabihf-gcc hello.c -o hello
file hello
# 输出应包含: ELF 32-bit LSB executable, ARM, EABI5
```

**`file` 命令是验证交叉编译结果最直接的手段**。看到 `ARM` 就对了，看到 `x86-64` 说明用错编译器了。

## 二、启动流程：四个阶段

这是理解嵌入式 Linux 的主线。**从上电到 shell，一共经历四个阶段**：

```
上电
 │
 ▼
① BootROM (芯片固化)      ← 芯片内部，改不了
 │  初始化最基本的时钟和 DDR，从指定介质加载 SPL
 ▼
② SPL / U-Boot 第一阶段    ← 很小（几 KB），跑在 SRAM
 │  初始化 DDR，加载完整的 U-Boot 到 DDR
 ▼
③ U-Boot (第二阶段)        ← 完整功能，跑在 DDR
 │  加载内核镜像和设备树到内存，跳转执行
 ▼
④ Linux 内核               ← 解压、初始化、挂载根文件系统
 │  启动 init 进程
 ▼
⑤ 用户空间 init → shell
```

**理解这条链的价值**：板子起不来时，你能通过"卡在哪一步"快速定位问题。

### 2.1 U-Boot 的作用

U-Boot 不只是引导，它还是个**功能完整的调试环境**：

```bash
# 进入 U-Boot 命令行（开机时按任意键）

# 查看环境变量
printenv

# 常见关键变量
#   bootargs  —— 传给内核的启动参数
#   bootcmd   —— 自动启动时执行的命令
#   ipaddr / serverip —— 网络相关，用于 tftp 下载

# 从 tftp 下载内核并启动（开发阶段最常用）
setenv serverip 192.168.1.100
setenv ipaddr 192.168.1.50
tftp 0x80008000 zImage
tftp 0x82000000 imx6ull.dtb
bootz 0x80008000 - 0x82000000

# 查看内存
md 0x80008000 10     # 显示 16 个字节

# 查看存储设备
mmc list
mmc dev 0
mmc info
```

**开发阶段用 tftp 加载内核，比每次烧写到 SD 卡快得多**。内核改一次烧一次，一天下来浪费的时间很可观。

### 2.2 bootargs：内核启动参数

这是最容易出错的地方之一。一个典型的 `bootargs`：

```bash
setenv bootargs 'console=ttymxc0,115200 root=/dev/mmcblk1p2 rootwait rw'
```

逐段解释：

| 参数 | 作用 |
|---|---|
| `console=ttymxc0,115200` | 内核控制台输出到哪个串口，波特率多少 |
| `root=/dev/mmcblk1p2` | 根文件系统在哪个设备分区 |
| `rootwait` | 等待设备就绪再挂载（**MMC/SD 卡必须加**） |
| `rw` | 以读写方式挂载根文件系统 |
| `init=/linuxrc` | 指定 init 程序（不写则用默认的） |
| `loglevel=7` | 内核日志级别，调试时调高 |

**`root=` 写错是最常见的启动失败原因**。分区号差一位就找不到根文件系统，内核会打印 `VFS: Cannot open root device`。

## 三、设备树：把硬件描述从代码里剥离

在设备树出现之前，每个板子的硬件信息都硬编码在内核的 `arch/arm/mach-xxx/` 目录里。结果就是**内核源码里塞满了各种开发板的描述文件**。

设备树（Device Tree）把这些信息抽出来，变成一份独立的硬件描述文件：

```
内核源码 (通用逻辑)  +  设备树 (板级硬件描述)  =  能跑的系统
     ↑                          ↑
  编译一次                    每块板子一份
```

### 3.1 设备树的结构

```dts
/* 根节点 */
/ {
    model = "My Custom Board";
    compatible = "fsl,imx6ull-14x14-evk", "fsl,imx6ull";

    /* 内存：内核用它来初始化内存管理 */
    memory@80000000 {
        device_type = "memory";
        reg = <0x80000000 0x20000000>;      /* 起始地址 + 大小 512MB */
    };

    /* 串口控制器 */
    &uart1 {
        pinctrl-names = "default";
        pinctrl-0 = <&pinctrl_uart1>;
        status = "okay";                     /* okay 启用，disabled 关闭 */
    };

    /* I2C 控制器及其上的设备 */
    &i2c1 {
        clock-frequency = <100000>;
        status = "okay";

        /* 挂在 I2C1 上的温湿度传感器 */
        sht30: sht30@44 {
            compatible = "sensirion,sht30";
            reg = <0x44>;                    /* I2C 从机地址 */
            status = "okay";
        };
    };
};
```

**关键属性**：

| 属性 | 作用 |
|---|---|
| `compatible` | **最核心**。内核靠它匹配驱动，格式是 `厂商,型号` |
| `reg` | 设备地址（I2C 从机地址 / 内存地址范围） |
| `status` | `okay` 启用 / `disabled` 禁用 |
| `pinctrl-0` | 引脚复用配置，引用 pinctrl 节点 |

**`compatible` 匹配不上，驱动就不会加载**，设备也不会有任何反应。这是设备树调试的核心。

### 3.2 引脚复用：pinctrl

```dts
&iomuxc {
    pinctrl_uart1: uart1grp {
        fsl,pins = <
            /* 引脚宏               复用功能      电气属性 */
            MX6UL_PAD_UART1_TX_DATA__UART1_DCE_TX  0x1b0b1
            MX6UL_PAD_UART1_RX_DATA__UART1_DCE_RX  0x1b0b1
        >;
    };
};
```

那个 `0x1b0b1` 是电气属性（上拉、驱动能力、压摆率等），**通常直接从厂商 SDK 的类似配置里抄**，改错了引脚可能没输出。

### 3.3 编译和调试设备树

```bash
# 编译 DTS → DTB
make dtbs

# 反编译 DTB 回 DTS（验证实际生效的内容）
dtc -I dtb -O dts -o check.dts arch/arm/boot/dts/my-board.dtb

# 查看内核实际解析出的设备树（板子启动后）
ls /proc/device-tree/
cat /proc/device-tree/model
```

**`/proc/device-tree/` 是验证设备树有没有生效的最直接方式**。如果这里看不到你加的节点，说明 DTB 没被正确加载。

## 四、根文件系统

内核启动的最后一步是挂载根文件系统并执行 init。没有它，内核会 panic：`No init found`。

### 4.1 最小根文件系统的目录结构

```
rootfs/
├── bin/          基础命令（sh, ls, cp...）
├── sbin/         系统管理命令（init, ifconfig...）
├── etc/          配置文件（inittab, fstab, passwd）
├── dev/          设备节点（console, null, tty...）
├── proc/         procfs 挂载点
├── sys/          sysfs 挂载点
├── lib/          动态库（.so）
├── usr/          用户程序
└── linuxrc 或 init   启动后的第一个进程
```

### 4.2 用 BusyBox 构建

BusyBox 把几百个常用命令塞进一个可执行文件，是嵌入式根文件系统的标准选择。

```bash
# 1. 下载并配置 BusyBox
wget https://busybox.net/downloads/busybox-1.36.1.tar.bz2
tar xf busybox-1.36.1.tar.bz2
cd busybox-1.36.1

make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- defconfig

# 关键：改成静态编译，省去拷贝动态库的麻烦
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- menuconfig
#   Settings → Build Options → [*] Build static binary (no shared libs)

make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- -j$(nproc)
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- install

# 2. 组装根文件系统
mkdir -p rootfs/{dev,proc,sys,etc,tmp}
cp -r _install/* rootfs/
```

### 4.3 两个必须的配置文件

**`etc/inittab`** —— 决定启动后做什么：

```
# 格式: <id>:<runlevels>:<action>:<process>
::sysinit:/etc/init.d/rcS        # 先执行初始化脚本
::askfirst:-/bin/sh              # 然后启动 shell
::ctrlaltdel:/sbin/reboot        # Ctrl+Alt+Del 重启
```

**`etc/init.d/rcS`** —— 初始化脚本，**挂载虚拟文件系统是关键**：

```bash
#!/bin/sh

# 挂载 proc 和 sysfs —— 不挂载的话很多命令不能用
mount -t proc none /proc
mount -t sysfs none /sys
mount -t tmpfs none /tmp

# 创建设备节点（用静态方式，简单可靠）
mknod /dev/console c 5 1
mknod /dev/null    c 1 3
mknod /dev/ttyS0   c 4 64

echo "根文件系统挂载完成"
```

`rcS` 必须有可执行权限：`chmod +x rootfs/etc/init.d/rcS`。漏了这一步会报 `Permission denied`，然后卡在启动阶段。

### 4.4 制作镜像

```bash
# 制作 ext4 镜像，大小 64MB
dd if=/dev/zero of=rootfs.ext4 bs=1M count=64
mkfs.ext4 rootfs.ext4

# 挂载并拷贝内容
mkdir -p /mnt/rootfs
sudo mount -o loop rootfs.ext4 /mnt/rootfs
sudo cp -a rootfs/* /mnt/rootfs/
sudo umount /mnt/rootfs

# 写入 SD 卡分区
sudo dd if=rootfs.ext4 of=/dev/sdX2 bs=4M conv=fsync
```

## 五、启动失败排查

按启动阶段对照现象：

| 现象 | 卡在 | 排查方向 |
|---|---|---|
| 串口完全没输出 | ①BootROM / ②SPL | 启动介质、拨码开关、串口线、供电 |
| 有 BootROM 信息，无 U-Boot | ②SPL | DDR 初始化参数、SPL 文件损坏 |
| U-Boot 有输出但起不来 | ③U-Boot | `bootcmd`、存储设备识别、环境变量损坏 |
| `Uncompressing Linux...` 后卡住 | ④内核解压 | DDR 大小配错、内核镜像损坏 |
| `VFS: Cannot open root device` | ④挂载根fs | **`root=` 参数错**、分区不存在、驱动没编进内核 |
| `No init found` | ④执行 init | 根文件系统里没有 init 或没有执行权限 |
| 内核起来了但没有 shell | ⑤用户空间 | `inittab` 配错、`rcS` 权限、console 没对上 |
| 能进 shell 但命令都找不到 | ⑤ | BusyBox 没装好、`PATH` 环境变量问题 |

### 几个实用技巧

**调高内核日志级别**，能看到更多信息：

```bash
setenv bootargs '... loglevel=8 ignore_loglevel'
```

**在关键位置加 earlyprintk**，内核启动早期就能看到输出：

```bash
setenv bootargs '... earlyprintk console=ttymxc0,115200'
```

**卡在挂载根文件系统时，先试试用 NFS**。如果 NFS 能起来，说明内核和设备树都没问题，纯粹是存储介质的问题：

```bash
setenv bootargs 'console=ttymxc0,115200 root=/dev/nfs nfsroot=192.168.1.100:/nfs/rootfs ip=192.168.1.50 rw'
```

NFS 挂载根文件系统在开发阶段**极其有用**——改了程序不用重新烧写，直接重启板子就生效。

## 小结

| 环节 | 核心要点 |
|---|---|
| 工具链 | 命名规则看懂 ABI；用 `file` 验证产物架构 |
| 启动流程 | 五个阶段，卡在哪一步就查哪一步 |
| U-Boot | 开发阶段用 tftp + NFS，比烧写快得多 |
| 设备树 | `compatible` 决定驱动匹配；`status` 决定启用；改完看 `/proc/device-tree/` |
| 根文件系统 | BusyBox 静态编译最省事；`rcS` 要挂 proc/sys 且要有执行权限 |
| 排查 | `loglevel=8` + `earlyprintk` 能看到更多线索 |

嵌入式 Linux 刚开始会觉得环节太多、处处是坑。但这条链路是**固定的**，走通一遍之后，换个芯片平台也就是改改设备树和配置参数的事。

---

**相关文章**：[嵌入式调试利器：JTAG、逻辑分析仪与示波器](#/article/debugging-tools) · [嵌入式学习路线：从零基础到项目实战](#/article/embedded-learning-roadmap)
