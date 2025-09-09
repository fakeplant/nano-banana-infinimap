import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/adapters/db.file'
import { writeTileFile } from '@/lib/storage'
import sharp from 'sharp'

const TILE_SIZE = parseInt(process.env.TILE_SIZE || '256')

async function generateParentTilesForUpload(z: number, x: number, y: number) {
  const { generateParentTile } = await import('@/lib/parentTiles');
  const { parentOf } = await import('@/lib/coords');

  console.log(`   🔄 Generating parent tiles for uploaded tile z:${z} x:${x} y:${y}`);

  let currentZ = z;
  let currentX = x;
  let currentY = y;

  // Generate all parent tiles up to zoom level 0
  while (currentZ > 0) {
    const parent = parentOf(currentZ, currentX, currentY);
    await generateParentTile(parent.z, parent.x, parent.y);

    currentZ = parent.z;
    currentX = parent.x;
    currentY = parent.y;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params
  const zoom = parseInt(z)
  const tileX = parseInt(x)
  const tileY = parseInt(y)

  try {
    const formData = await request.formData()
    const file = formData.get('tile') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    
    // Process and resize image to exact tile size
    const processedBuffer = await sharp(fileBuffer)
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
      .webp({ quality: 90 })
      .toBuffer()

    // Store the tile
    await writeTileFile(zoom, tileX, tileY, processedBuffer)
    
    // Update database
    await db.upsertTile({
      z: zoom,
      x: tileX,
      y: tileY,
      status: 'READY',
      hash: Buffer.from(processedBuffer).toString('base64').slice(0, 8)
    })

    // Generate parent tiles automatically (same as normal tile generation)
    generateParentTilesForUpload(zoom, tileX, tileY).catch(err =>
      console.error(`Failed to generate parent tiles after upload: ${err}`)
    );

    return NextResponse.json({ 
      success: true,
      message: 'Tile uploaded successfully'
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload tile' },
      { status: 500 }
    )
  }
}