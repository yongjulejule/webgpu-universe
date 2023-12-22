import { useEffect, useRef, useState } from 'react';
import drawingShader from './draw.wgsl?raw';
import computeShader from './compute.wgsl?raw'

const gpu = async (canvas: HTMLCanvasElement, interval: number) => {
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
    code: drawingShader,
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

  const workgroupSize = 16;

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


  // Create the compute shader that will process the simulation.
  const simulationShaderModule = device.createShaderModule({
    label: 'Life simulation shader',
    code: computeShader,
  });

  // Create a compute pipeline that updates the game state.
  const simulationPipeline = device.createComputePipeline({
    label: 'Simulation pipeline',
    layout: pipelineLayout,
    compute: {
      module: simulationShaderModule,
      entryPoint: 'computeMain',
      constants: {
        // The workgroup size is used to calculate the cell's neighbors.
        workgroupSize: workgroupSize,
      },
    },
  });

  let step = 0; // Track how many simulation steps have been run

  // Move all of our rendering code into a function
  function updateGrid() {
    // Start a render pass
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);

    const workgroupCount = Math.ceil(GRID_SIZE / 16);
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
  // return setInterval(updateGrid, interval);
  return updateGrid;
};

export default function LifeGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timer, setTimer] = useState(100);

  let run : any = undefined;
  useEffect(() => {
    let id: any;

    const runGpu = async () => {
      if (canvasRef.current) {
        run = await gpu(canvasRef.current, timer);
        id = setInterval(run, timer);
      }
    }

    runGpu();

    return () => {
      if (id) clearInterval(id);
      canvasRef.current = null;
    };
  }, [timer]);

  return (
    <div>
      <canvas ref={canvasRef} width='512' height='512'></canvas>
      <input type='range' min='10' max='1000' value={timer} onChange={(e) => setTimer(Number(e.target.value))} />
    </div>
  );
}
