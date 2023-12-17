'use client';

import { useEffect, useRef } from 'react';

const gpu = async (canvas: HTMLCanvasElement) => {
  // const canvas = document.querySelector('canvas');

  if (!navigator.gpu) {
    throw new Error(
      '크롬 쓰셈 (https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API#browser_compatibility)'
    );
  }

  // @see https://gpuweb.github.io/gpuweb/#gpuadapter
  const adapter = await navigator.gpu.requestAdapter(); // or "low-power"
  if (!adapter) {
    throw new Error(
      '브라우저는 webGPU 를 쓸 수 있는데 너의 하드웨어는 그렇지 않네'
    );
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('webgpu 를 쓸 수 없네');
  }
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
  });

  const vertices = new Float32Array([
    -0.8, -0.8, 0.8, -0.8, 0.8, 0.8, -0.8, -0.8, 0.8, 0.8, -0.8, 0.8,
  ]);

  const vertexBuffer = device.createBuffer({
    label: 'Cell vertices',
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);

  const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [
      {
        format: 'float32x2' as const,
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
      },
    ],
  };

  const cellShaderModule = device.createShaderModule({
    label: 'Cell shader',
    code: `
struct VertexOutput {
@builtin(position) position: vec4f,
@location(0) cell: vec2f,
};

@group(0) @binding(0) var<uniform> grid: vec2f;
@group(0) @binding(1) var<storage> cellState: array<u32>;


// vertex shader.  클립 스페이스로 변환 (x, y) -> (-1, -1) ~ (1, 1)
@vertex
fn vertexMain(@location(0) position: vec2f,
            @builtin(instance_index) instance: u32) -> VertexOutput {
let i = f32(instance);
let cell = vec2f(i % grid.x, floor(i / grid.x));
let state = f32(cellState[instance]);

let cellOffset = cell / grid * 2;
let gridPos = (position * state + 1) / grid - 1 + cellOffset;

var output: VertexOutput;
output.position = vec4f(gridPos, 0, 1);
output.cell = cell;
return output;
}

// fragment shader.  그리드 좌표 기반으로 색상 계산
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let c = input.cell / grid;
  return vec4f(c, 1-c.x, 1);
}
`,
  });
  // Create the bind group layout and pipeline layout.
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'Cell Bind Group Layout',
    entries: [
      {
        binding: 0,
        visibility:
          GPUShaderStage.VERTEX |
          GPUShaderStage.COMPUTE |
          GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' as const }, // Grid uniform buffer
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' as const }, // Cell state input buffer
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' as const }, // Cell state output buffer
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'Cell Pipeline Layout',
    bindGroupLayouts: [bindGroupLayout],
  });

  const cellPipeline = device.createRenderPipeline({
    label: 'Cell pipeline',
    layout: pipelineLayout,
    vertex: {
      module: cellShaderModule,
      entryPoint: 'vertexMain',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: cellShaderModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format: canvasFormat,
        },
      ],
    },
  });

  // Create a uniform buffer that describes the grid.

  const GRID_SIZE = 64;

  const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
  const uniformBuffer = device.createBuffer({
    label: 'Grid Uniforms',
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

  // Create an array representing the active state of each cell.
  const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);

  // Create a storage buffer to hold the cell state.
  const cellStateStorage = [
    device.createBuffer({
      label: 'Cell State A',
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
      label: 'Cell State B',
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  ];

  // Mark every third cell of the grid as active.
  for (let i = 0; i < cellStateArray.length; ++i) {
    cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
  }
  device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

  // Mark every other cell of the second grid as active.
  for (let i = 0; i < cellStateArray.length; i++) {
    cellStateArray[i] = i % 2;
  }
  device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

  // Create a bind group to pass the grid uniforms into the pipeline
  const bindGroups = [
    device.createBindGroup({
      label: 'Cell renderer bind group A',
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[0] },
        },
        {
          binding: 2,
          resource: { buffer: cellStateStorage[1] },
        },
      ],
    }),
    device.createBindGroup({
      label: 'Cell renderer bind group B',
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[1] },
        },
        {
          binding: 2,
          resource: { buffer: cellStateStorage[0] },
        },
      ],
    }),
  ];

  const WORKGROUP_SIZE = 16;

  // Create the compute shader that will process the simulation.
  const simulationShaderModule = device.createShaderModule({
    label: 'Life simulation shader',
    code: `
@group(0) @binding(0) var<uniform> grid: vec2f;

@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

fn cellIndex(cell: vec2u) -> u32 {
  return (cell.y % u32(grid.y)) * u32(grid.x) +
          (cell.x % u32(grid.x));
}

fn cellActive(x: u32, y: u32) -> u32 {
  return cellStateIn[cellIndex(vec2(x, y))];
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
  // Determine how many active neighbors this cell has.
  let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
                        cellActive(cell.x+1, cell.y) +
                        cellActive(cell.x+1, cell.y-1) +
                        cellActive(cell.x, cell.y-1) +
                        cellActive(cell.x-1, cell.y-1) +
                        cellActive(cell.x-1, cell.y) +
                        cellActive(cell.x-1, cell.y+1) +
                        cellActive(cell.x, cell.y+1);

  let i = cellIndex(cell.xy);

  // Conway's game of life rules:
  switch activeNeighbors {
    case 2: {
      cellStateOut[i] = cellStateIn[i];
    }
    case 3: {
      cellStateOut[i] = 1;
    }
    default: {
      cellStateOut[i] = 0;
    }
  }
}
`,
  });

  // Create a compute pipeline that updates the game state.
  const simulationPipeline = device.createComputePipeline({
    label: 'Simulation pipeline',
    layout: pipelineLayout,
    compute: {
      module: simulationShaderModule,
      entryPoint: 'computeMain',
    },
  });

  const UPDATE_INTERVAL = 42;
  let step = 0; // Track how many simulation steps have been run

  // Move all of our rendering code into a function
  function updateGrid() {
    // Start a render pass
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);

    const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount, workgroupCount);

    computePass.end();

    step++; // Increment the step count

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          loadOp: 'clear' as const,
          clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
          storeOp: 'store' as const,
        },
      ],
    });

    // Draw the grid.

    pass.setPipeline(cellPipeline);
    pass.setBindGroup(0, bindGroups[step % 2]); // Updated!
    pass.setVertexBuffer(0, vertexBuffer);
    const instanceCount = GRID_SIZE * GRID_SIZE;
    pass.draw(vertices.length / 2, instanceCount); // 6 vertices

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // Schedule updateGrid() to run repeatedly
  setInterval(updateGrid, UPDATE_INTERVAL);
};

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      gpu(canvasRef.current);
    }
  }, []);

  return (
    <div>
      <h1>Conway&apos;s game of life</h1>
      <canvas ref={canvasRef} width='512' height='512'></canvas>
    </div>
  );
}
